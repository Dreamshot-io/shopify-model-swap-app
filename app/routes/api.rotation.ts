import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { SimpleRotationService } from '../services/simple-rotation.server';
import { AuditService } from '../services/audit.server';
import { authenticate } from '../shopify.server';

const AUTH_HEADER = 'authorization';
const VERCEL_CRON_HEADER = 'x-vercel-cron';

/**
 * Handle rotation requests from cron or manual trigger
 */
async function handleRotationRequest(request: Request) {
  const expectedToken = process.env.ROTATION_CRON_TOKEN;

  // Check for Vercel cron header (Vercel automatically sets this for cron jobs)
  const vercelCronHeader = request.headers.get(VERCEL_CRON_HEADER);
  const isVercelCron = vercelCronHeader === '1';

  // Check for Bearer token (for manual POST requests)
  const token = extractBearerToken(request.headers.get(AUTH_HEADER));
  const isAuthorized = expectedToken && token === expectedToken;

  if (!isVercelCron && !isAuthorized) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const results = [];

  try {
    // Get all active tests due for rotation
    const tests = await SimpleRotationService.getTestsDueForRotation();

    // Log cron job start
    await AuditService.logCronJob('SYSTEM', {
      status: 'STARTED',
      testsToRotate: tests.length,
      testIds: tests.map(t => t.id),
    });

    // Rotate each test
    for (const test of tests) {
      try {
        // We need admin context for each shop
        // For now, we'll need to get it from the session store
        // In production, you'd want to cache these or handle differently
        const { admin } = await authenticate.admin(request);

        const result = await SimpleRotationService.rotateTest(
          test.id,
          'CRON',
          undefined,
          admin
        );

        results.push({
          testId: test.id,
          success: true,
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

    // Log cron job completion
    await AuditService.logCronJob('SYSTEM', {
      status: 'COMPLETED',
      duration,
      testsRotated: results.filter(r => r.success).length,
      testsFailed: results.filter(r => !r.success).length,
      results,
    });

    return json({
      ok: true,
      summary: {
        processed: tests.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        duration,
        results,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Log cron job failure
    await AuditService.logCronJob('SYSTEM', {
      status: 'FAILED',
      error: message,
      duration: Date.now() - startTime,
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