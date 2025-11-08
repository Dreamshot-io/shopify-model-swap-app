import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { SimpleRotationService } from '../services/simple-rotation.server';
import { AuditService } from '../services/audit.server';
import db from '../db.server';
// import { rotationStateRateLimiter, applyRateLimit } from '../utils/rate-limiter';

/**
 * API endpoint for tracking pixel to get current rotation state
 * Returns which case (BASE or TEST) is currently active for a product
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  const variantId = normalizeVariantId(url.searchParams.get('variantId'));

  if (!productId) {
    return json({ error: 'Missing productId' }, { status: 400 });
  }

  let corsHeaders: Record<string, string> = {};
  let shopDomain: string | undefined;

  // Try app proxy authentication, but allow fallback for direct calls
  try {
    const { session, cors } = await authenticate.public.appProxy(request);
    shopDomain = session?.shop;
    corsHeaders = cors?.headers || {};
  } catch {
    // Allow public access with CORS headers for direct pixel calls
    corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Rate limiting temporarily disabled
    // const rateLimitResult = applyRateLimit(request, rotationStateRateLimiter);
    // corsHeaders = { ...corsHeaders, ...rateLimitResult.headers };

    // if (!rateLimitResult.allowed) {
    //   return json(
    //     { error: rateLimitResult.message },
    //     { status: 429, headers: corsHeaders }
    //   );
    // }
  }

  try {
    // Get rotation state for the product
    const { testId, activeCase } = await SimpleRotationService.getRotationState(productId);

    if (!testId) {
      // No active test for this product
      return json(
        {
          testId: null,
          activeCase: null,
          variantCase: null,
        },
        { headers: corsHeaders },
      );
    }

    // For variant-level tests, check if this specific variant has a different case
    let variantCase = null;
    if (variantId) {
      const variant = await db.aBTestVariant.findUnique({
        where: {
          testId_shopifyVariantId: {
            testId,
            shopifyVariantId: variantId,
          },
        },
      });

      if (variant) {
        // For now, variant follows the global test state
        // In future, we could have per-variant rotation if needed
        variantCase = activeCase;
      }
    }

    // Log impression tracking initialization (sampled to avoid spam)
    if (Math.random() < 0.01 && shopDomain) { // 1% sampling
      await AuditService.logUserAction(
        'PIXEL_INITIALIZED',
        'tracking-pixel',
        shopDomain,
        {
          productId,
          variantId,
          testId,
          activeCase,
        }
      );
    }

    return json(
      {
        testId,
        activeCase, // BASE or TEST
        variantCase, // For variant-specific tests
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';

    // Log API errors
    await AuditService.logApiError(
      'SYSTEM',
      '/api/rotation-state',
      error as Error
    );

    return json({ error: message }, { status: 500 });
  }
};

/**
 * Normalize variant ID to Shopify GID format
 */
function normalizeVariantId(variantId: string | null): string | null {
  if (!variantId) return null;
  if (variantId.startsWith('gid://shopify/ProductVariant/')) {
    return variantId;
  }
  if (/^\d+$/.test(variantId)) {
    return `gid://shopify/ProductVariant/${variantId}`;
  }
  return variantId;
}
