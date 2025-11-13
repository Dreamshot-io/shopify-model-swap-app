import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { AuditService } from '../services/audit.server';
// import { trackingRateLimiter, applyRateLimit } from '../utils/rate-limiter';

/**
 * Handle OPTIONS preflight requests for CORS
 * In Remix, OPTIONS requests go to loader, not action
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return json({}, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
      }
    });
  }

  // For non-OPTIONS GET requests, return method not allowed
  return json({ error: 'Method not allowed. Use POST to track events.' }, {
    status: 405,
    headers: {
      'Access-Control-Allow-Origin': '*',
    }
  });
};

/**
 * Track events from the web pixel (impressions, add-to-cart, purchases)
 */
export const action = async ({ request }: ActionFunctionArgs) => {

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, {
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  let corsHeaders: Record<string, string> = {};
  let shopDomain: string | undefined;

  // Check if this is a pixel request (no signature = direct browser call)
  const hasSignature = request.headers.get('x-shopify-hmac-sha256') ||
                       new URL(request.url).searchParams.has('signature');

  // Try app proxy authentication only if signature present (admin requests)
  // Pixel requests from storefront won't have signature, so skip auth
  if (hasSignature) {
    try {
      const { session, cors } = await authenticate.public.appProxy(request);
      shopDomain = session?.shop;
      corsHeaders = cors?.headers || {};
    } catch (error) {
      // If signature present but invalid, log but continue with public access
      console.warn('[track] App proxy auth failed, using public access', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Always set CORS headers for pixel requests (direct browser calls)
  if (!corsHeaders['Access-Control-Allow-Origin']) {
    corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
    };
  }

  try {
    const body = await request.json();

    // Log raw body for debugging
    console.log('[Track API] Raw request body:', JSON.stringify(body, null, 2));

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

    // Validate and normalize sessionId
    let normalizedSessionId: string | null = null;
    if (typeof sessionId === 'string') {
      normalizedSessionId = sessionId;
    } else if (sessionId && typeof sessionId === 'object') {
      console.warn('[Track API] sessionId is an object, attempting to extract:', sessionId);
      // Try to extract string from object (shouldn't happen, but handle it)
      normalizedSessionId = String(sessionId);
    } else if (sessionId === null || sessionId === undefined) {
      console.warn('[Track API] sessionId is null/undefined');
    } else {
      console.warn('[Track API] sessionId has unexpected type:', typeof sessionId, sessionId);
      normalizedSessionId = String(sessionId);
    }

    // Validate required fields with detailed logging
    if (!testId || !normalizedSessionId || !eventType || !productId || !activeCase) {
      const missingFields = {
        hasTestId: Boolean(testId),
        hasSessionId: Boolean(normalizedSessionId),
        hasEventType: Boolean(eventType),
        hasProductId: Boolean(productId),
        hasActiveCase: Boolean(activeCase),
      };

      console.warn('[Track API] Missing required fields', {
        missingFields,
        receivedBody: {
          testId,
          sessionId: { raw: sessionId, normalized: normalizedSessionId, type: typeof sessionId },
          eventType,
          productId,
          activeCase
        },
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
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Origin': '*',
          }
        },
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
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Origin': '*',
          }
        },
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
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Origin': '*',
          }
        },
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
        sessionId: normalizedSessionId || sessionId,
      });

      await AuditService.logApiError(
        shopDomain || 'UNKNOWN',
        '/track',
        new Error(`Test not found: ${testId} for shop: ${shopDomain || 'UNKNOWN'}`)
      );

      return json(
        { error: 'Test not found or unauthorized', testId, shop: shopDomain },
        {
          status: 404,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Origin': '*',
          }
        },
      );
    }

    // Use test's shop if we don't have it from auth
    shopDomain = shopDomain || test.shop;

    // Normalize variant ID if provided
    const normalizedVariantId = normalizeVariantId(variantId ?? null);

    // Check for duplicate events (only for impressions to prevent double-counting)
    if (eventType === 'IMPRESSION' && normalizedSessionId) {
      const duplicateEvent = await db.aBTestEvent.findFirst({
        where: {
          testId,
          sessionId: normalizedSessionId, // Use normalized version
          eventType,
          productId,
        },
      });

      if (duplicateEvent) {
        // Log duplicate detection (sampled to avoid spam)
        if (Math.random() < 0.01) {
          console.log('[Track API] Duplicate impression detected and skipped', {
            testId,
            sessionId: normalizedSessionId,
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
      // Use normalizedSessionId to ensure it's a string
      if (!normalizedSessionId) {
        throw new Error('sessionId is required but was null or invalid');
      }

      createdEvent = await db.aBTestEvent.create({
        data: {
          testId,
          sessionId: normalizedSessionId, // Use normalized version
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
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Origin': '*',
          }
        },
      );
    }

    // Log significant events (purchases always, others sampled)
    if (eventType === 'PURCHASE' || Math.random() < 0.1) {
      await AuditService.logUserAction(
        `CUSTOMER_${eventType}`,
        normalizedSessionId || 'unknown',
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
      console.log('[Track API] ✅ Event tracked successfully', {
        eventId: createdEvent.id,
        eventType,
        testId,
        activeCase,
        productId,
        sessionId: normalizedSessionId,
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
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Access-Control-Allow-Origin': '*',
        }
      }
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
