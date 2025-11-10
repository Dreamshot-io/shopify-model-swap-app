import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { AuditService } from '../services/audit.server';
// import { trackingRateLimiter, applyRateLimit } from '../utils/rate-limiter';

/**
 * Track events from the web pixel (impressions, add-to-cart, purchases)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
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
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Rate limiting temporarily disabled
    // const rateLimitResult = applyRateLimit(request, trackingRateLimiter);
    // corsHeaders = { ...corsHeaders, ...rateLimitResult.headers };

    // if (!rateLimitResult.allowed) {
    //   return json(
    //     { error: rateLimitResult.message },
    //     { status: 429, headers: corsHeaders }
    //   );
    // }
  }

  try {
    const body = await request.json();
    const {
      testId,
      sessionId,
      eventType,
      activeCase,
      revenue,
      quantity,
      productId,
      variantId,
      metadata,
    } = body ?? {};

    // Validate required fields with detailed logging
    if (!testId || !sessionId || !eventType || !productId || !activeCase) {
      const missingFields = {
        hasTestId: Boolean(testId),
        hasSessionId: Boolean(sessionId),
        hasEventType: Boolean(eventType),
        hasProductId: Boolean(productId),
        hasActiveCase: Boolean(activeCase),
      };

      console.warn('[Track API] Missing required fields', {
        missingFields,
        receivedBody: { testId, sessionId, eventType, productId, activeCase },
        shop: shopDomain,
      });

      await AuditService.logApiError(
        shopDomain || 'UNKNOWN',
        '/track',
        new Error(`Missing required fields: ${JSON.stringify(missingFields)}`)
      );

      return json(
        {
          error: 'Missing required fields',
          details: missingFields,
        },
        { status: 400, headers: corsHeaders },
      );
    }

    // Validate event type
    const validEventTypes = ['IMPRESSION', 'ADD_TO_CART', 'PURCHASE'];
    if (!validEventTypes.includes(eventType)) {
      console.warn('[Track API] Invalid event type', {
        received: eventType,
        valid: validEventTypes,
        testId,
        productId,
        shop: shopDomain,
      });

      await AuditService.logApiError(
        shopDomain || 'UNKNOWN',
        '/track',
        new Error(`Invalid event type: ${eventType}`)
      );

      return json(
        { error: 'Invalid event type', received: eventType, valid: validEventTypes },
        { status: 400, headers: corsHeaders },
      );
    }

    // Validate active case
    const validCases = ['BASE', 'TEST'];
    if (!validCases.includes(activeCase)) {
      console.warn('[Track API] Invalid active case', {
        received: activeCase,
        valid: validCases,
        testId,
        productId,
        eventType,
        shop: shopDomain,
      });

      await AuditService.logApiError(
        shopDomain || 'UNKNOWN',
        '/track',
        new Error(`Invalid active case: ${activeCase}`)
      );

      return json(
        { error: 'Invalid active case', received: activeCase, valid: validCases },
        { status: 400, headers: corsHeaders },
      );
    }

    // Verify test exists (and optionally belongs to this shop if we have shopDomain)
    const test = await db.aBTest.findFirst({
      where: shopDomain
        ? {
            id: testId,
            shop: shopDomain,
          }
        : {
            id: testId,
          },
    });

    if (!test) {
      console.warn('[Track API] Test not found or unauthorized', {
        testId,
        shop: shopDomain,
        eventType,
        productId,
        sessionId,
      });

      await AuditService.logApiError(
        shopDomain || 'UNKNOWN',
        '/track',
        new Error(`Test not found: ${testId} for shop: ${shopDomain || 'UNKNOWN'}`)
      );

      return json(
        { error: 'Test not found or unauthorized', testId, shop: shopDomain },
        { status: 404, headers: corsHeaders },
      );
    }

    // Use test's shop if we don't have it from auth
    shopDomain = shopDomain || test.shop;

    // Normalize variant ID if provided
    const normalizedVariantId = normalizeVariantId(variantId ?? null);

    // Check for duplicate events (only for impressions to prevent double-counting)
    if (eventType === 'IMPRESSION') {
      const duplicateEvent = await db.aBTestEvent.findFirst({
        where: {
          testId,
          sessionId,
          eventType,
          productId,
        },
      });

      if (duplicateEvent) {
        // Log duplicate detection (sampled to avoid spam)
        if (Math.random() < 0.01) {
          console.log('[Track API] Duplicate impression detected and skipped', {
            testId,
            sessionId,
            productId,
            existingEventId: duplicateEvent.id,
            shop: shopDomain,
          });
        }

        return json(
          { success: true, message: 'Event already tracked', eventId: duplicateEvent.id },
          { headers: corsHeaders },
        );
      }
    }

    // Create the event
    let createdEvent;
    try {
      createdEvent = await db.aBTestEvent.create({
        data: {
          testId,
          sessionId,
          eventType,
          activeCase, // What was showing when event occurred
          productId,
          variantId: normalizedVariantId,
          revenue: revenue ? Number.parseFloat(String(revenue)) : null,
          quantity: quantity ? Number.parseInt(String(quantity), 10) : null,
          metadata: metadata || {},
        },
      });
    } catch (dbError) {
      console.error('[Track API] Database error creating event', {
        error: dbError,
        testId,
        eventType,
        productId,
        shop: shopDomain,
      });

      await AuditService.logApiError(
        shopDomain || 'UNKNOWN',
        '/track',
        dbError as Error
      );

      return json(
        { error: 'Failed to create event in database', details: (dbError as Error).message },
        { status: 500, headers: corsHeaders },
      );
    }

    // Log significant events (purchases always, others sampled)
    if (eventType === 'PURCHASE' || Math.random() < 0.1) {
      await AuditService.logUserAction(
        `CUSTOMER_${eventType}`,
        sessionId,
        shopDomain!,
        {
          testId,
          activeCase,
          productId,
          variantId: normalizedVariantId,
          revenue,
        }
      );
    }

    // Log successful tracking (sampled for non-purchase events)
    if (eventType === 'PURCHASE' || Math.random() < 0.05) {
      console.log('[Track API] Event tracked successfully', {
        eventId: createdEvent.id,
        eventType,
        testId,
        activeCase,
        productId,
        shop: shopDomain,
      });
    }

    return json(
      {
        success: true,
        eventId: createdEvent.id,
        activeCase,
        message: `${eventType} event tracked successfully`,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';

    // Enhanced error logging with context
    console.error('[Track API] Unexpected error', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      shop: shopDomain,
      url: request.url,
      method: request.method,
    });

    // Log tracking errors
    await AuditService.logApiError(
      shopDomain || 'UNKNOWN',
      '/track',
      error as Error
    );

    return json(
      {
        error: message,
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined,
      },
      { status: 500, headers: corsHeaders }
    );
  }
};

/**
 * Normalize variant ID to Shopify GID format
 */
export function normalizeVariantId(variantId: string | null): string | null {
  if (!variantId) return null;
  if (variantId.startsWith('gid://shopify/ProductVariant/')) {
    return variantId;
  }
  if (/^\d+$/.test(variantId)) {
    return `gid://shopify/ProductVariant/${variantId}`;
  }
  return variantId;
}
