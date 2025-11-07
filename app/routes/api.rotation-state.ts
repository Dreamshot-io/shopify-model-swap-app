import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { SimpleRotationService } from '../services/simple-rotation.server';
import { AuditService } from '../services/audit.server';
import db from '../db.server';

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

  try {
    const { session, cors } = await authenticate.public.appProxy(request);
    const corsHeaders = cors?.headers || {};

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
    if (Math.random() < 0.01) { // 1% sampling
      await AuditService.logUserAction(
        'PIXEL_INITIALIZED',
        'tracking-pixel',
        session.shop,
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
