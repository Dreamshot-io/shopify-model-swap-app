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
  // Handle OPTIONS preflight for CORS
  if (request.method === 'OPTIONS') {
    return json({}, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
      }
    });
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  const variantId = normalizeVariantId(url.searchParams.get('variantId'));

  if (!productId) {
    return json({ error: 'Missing productId' }, {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  let corsHeaders: Record<string, string> = {};
  let shopDomain: string | undefined;

  // Check if this is a pixel request (no signature = direct browser call)
  const hasSignature = url.searchParams.has('signature') ||
                       request.headers.get('x-shopify-hmac-sha256');

  // Try app proxy authentication only if signature present (admin requests)
  // Pixel requests from storefront won't have signature, so skip auth
  if (hasSignature) {
    try {
      const { session, cors } = await authenticate.public.appProxy(request);
      shopDomain = session?.shop;
      corsHeaders = cors?.headers || {};
    } catch (error) {
      // If signature present but invalid, log but continue with public access
      console.warn('[rotation-state] App proxy auth failed, using public access', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Always set CORS headers for pixel requests (direct browser calls)
  if (!corsHeaders['Access-Control-Allow-Origin']) {
    corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
    };
  }

  try {
    // Normalize productId to handle both GID and numeric formats
    let normalizedProductId = productId;

    // If it's a GID format, use as-is
    // If it's numeric, convert to GID format for consistent matching
    if (productId && !productId.startsWith('gid://shopify/Product/')) {
      if (/^\d+$/.test(productId)) {
        normalizedProductId = `gid://shopify/Product/${productId}`;
        console.log('[rotation-state] Normalized numeric productId to GID:', {
          original: productId,
          normalized: normalizedProductId
        });
      }
    }

    // Try both formats to handle cases where test might have numeric or GID
    console.log('[rotation-state] Searching for test with productId:', normalizedProductId);
    let { testId, activeCase } = await SimpleRotationService.getRotationState(normalizedProductId);

    // If not found with GID format and original was numeric, try numeric
    if (!testId && normalizedProductId !== productId && /^\d+$/.test(productId)) {
      console.log('[rotation-state] Not found with GID, trying numeric:', productId);
      const numericResult = await SimpleRotationService.getRotationState(productId);
      if (numericResult.testId) {
        testId = numericResult.testId;
        activeCase = numericResult.activeCase;
        console.log('[rotation-state] Found with numeric format:', { testId, activeCase });
      }
    }

    if (testId) {
      console.log('[rotation-state] ✅ Test found:', { testId, activeCase, productId: normalizedProductId });
    } else {
      console.log('[rotation-state] ❌ No test found for productId:', normalizedProductId);
    }

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

    return json({ error: message }, {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
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
