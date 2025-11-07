import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { AuditService } from '../services/audit.server';

/**
 * Track events from the web pixel (impressions, add-to-cart, purchases)
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  let corsHeaders: Record<string, string> = {};
  let shopDomain: string | undefined;

  try {
    const { session, cors } = await authenticate.public.appProxy(request);
    shopDomain = session?.shop;
    corsHeaders = cors?.headers || {};

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

    // Validate required fields
    if (!testId || !sessionId || !eventType || !productId || !activeCase) {
      return json(
        {
          error: 'Missing required fields',
          details: {
            hasTestId: Boolean(testId),
            hasSessionId: Boolean(sessionId),
            hasEventType: Boolean(eventType),
            hasProductId: Boolean(productId),
            hasActiveCase: Boolean(activeCase),
          },
        },
        { status: 400, headers: corsHeaders },
      );
    }

    // Validate event type
    const validEventTypes = ['IMPRESSION', 'ADD_TO_CART', 'PURCHASE'];
    if (!validEventTypes.includes(eventType)) {
      return json(
        { error: 'Invalid event type', received: eventType, valid: validEventTypes },
        { status: 400, headers: corsHeaders },
      );
    }

    // Validate active case
    const validCases = ['BASE', 'TEST'];
    if (!validCases.includes(activeCase)) {
      return json(
        { error: 'Invalid active case', received: activeCase, valid: validCases },
        { status: 400, headers: corsHeaders },
      );
    }

    // Verify test exists and belongs to this shop
    const test = await db.aBTest.findFirst({
      where: {
        id: testId,
        shop: shopDomain,
      },
    });

    if (!test) {
      return json(
        { error: 'Test not found or unauthorized', testId, shop: shopDomain },
        { status: 404, headers: corsHeaders },
      );
    }

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
        return json(
          { success: true, message: 'Event already tracked', eventId: duplicateEvent.id },
          { headers: corsHeaders },
        );
      }
    }

    // Create the event
    const createdEvent = await db.aBTestEvent.create({
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

    // Log tracking errors
    await AuditService.logApiError(
      shopDomain || 'UNKNOWN',
      '/track',
      error as Error
    );

    return json({ error: message }, { status: 500, headers: corsHeaders });
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