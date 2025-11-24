import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import { SimpleRotationService } from '../services/simple-rotation.server';
import { CompatibilityRotationService } from '../services/compatibility-rotation.server';
import { AuditService } from '../services/audit.server';
import db from '../db.server';

const AUTH_HEADER = 'authorization';
const VERCEL_CRON_HEADER = 'x-vercel-cron';

/**
 * Handle rotation requests from cron or manual trigger
 * 
 * Auth: Vercel automatically sends CRON_SECRET as Authorization header for cron jobs.
 * Manual requests can also use Bearer token with CRON_SECRET value.
 */
async function handleRotationRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  // Check for Vercel cron header (Vercel automatically sets this for cron jobs)
  const vercelCronHeader = request.headers.get(VERCEL_CRON_HEADER);
  const isVercelCron = vercelCronHeader === '1';

  // Vercel sends CRON_SECRET as Bearer token in Authorization header
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = extractBearerToken(authHeader);
  const isAuthorizedBySecret = cronSecret && token === cronSecret;

  if (!isVercelCron && !isAuthorizedBySecret) {
    console.log('[Rotation] Unauthorized request rejected');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Rotation] Cron triggered', { isVercelCron, hasSecret: !!isAuthorizedBySecret });

  const startTime = Date.now();
  const results = [];

  try {
    // Get all active tests due for rotation
    const tests = await SimpleRotationService.getTestsDueForRotation();

    console.log('[Rotation] Found tests due for rotation:', tests.length);

    // Log cron job start
    await AuditService.logCronJob('SYSTEM', {
      status: 'STARTED',
      testsToRotate: tests.length,
      testIds: tests.map(t => t.id),
    });

    // Rotate each test
    for (const test of tests) {
      try {
        console.log('[Rotation] Processing test', { testId: test.id, shop: test.shop, currentCase: test.currentCase });

        // Get the session for this shop to get the access token
        const session = await db.session.findFirst({
          where: { shop: test.shop },
          orderBy: { id: 'desc' }, // Get the most recent session
        });

        if (!session || !session.accessToken) {
          throw new Error(`No valid session found for shop ${test.shop}`);
        }

		// Create an admin GraphQL client directly using the stored access token
		// Must match the interface that the real admin object uses
		type AdminGraphQLClient = {
			graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
		};
		const admin: AdminGraphQLClient = {
			graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
				const response = await fetch(`https://${test.shop}/admin/api/2025-01/graphql.json`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Shopify-Access-Token': session.accessToken,
					},
					body: JSON.stringify({
						query,
						variables: options?.variables || undefined,
					}),
				});

				if (!response.ok) {
					const errorText = await response.text();
					console.error('[Cron Admin] GraphQL request failed:', response.status, errorText);
					throw new Error(`GraphQL request failed: ${response.statusText}`);
				}

				// Return the response object (caller will call .json() on it)
				return response;
			},
		};

		// Use CompatibilityRotationService for automatic V1/V2 selection
		const compatibilityService = new CompatibilityRotationService(admin as AdminApiContext, db);

        // Determine target case (toggle from current)
        const targetCase = test.currentCase === 'BASE' ? 'TEST' : 'BASE';

        const result = await compatibilityService.rotateTest(
          test.id,
          targetCase,
          'CRON'
        );

        results.push({
          testId: test.id,
          ...result,
        });
      } catch (error) {
        console.error(`Failed to rotate test ${test.id}:`, error);
        results.push({
          testId: test.id,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('[Rotation] Completed', { processed: tests.length, successful, failed, duration });

    // Log cron job completion
    await AuditService.logCronJob('SYSTEM', {
      status: 'COMPLETED',
      duration,
      testsRotated: successful,
      testsFailed: failed,
      results,
    });

    return json({
      ok: true,
      summary: {
        processed: tests.length,
        successful,
        failed,
        duration,
        results,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const duration = Date.now() - startTime;

    console.error('[Rotation] Failed', { error: message, duration });

    // Log cron job failure
    await AuditService.logCronJob('SYSTEM', {
      status: 'FAILED',
      error: message,
      duration,
    });

    return json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * GET endpoint for Vercel cron
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleRotationRequest(request);
};

/**
 * POST endpoint for manual triggers
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }
  return handleRotationRequest(request);
};

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  return token ?? null;
}
