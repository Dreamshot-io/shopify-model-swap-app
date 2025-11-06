import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { RotationVariant } from '@prisma/client';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { variantAtTimestamp } from '../services/ab-test-rotation.store';

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
    const { testId, sessionId, eventType, revenue, productId, shopifyVariantId, occurredAt } = body ?? {};

    if (!testId || !sessionId || !eventType || !productId) {
      return json(
        {
          error: 'Missing required fields',
          details: {
            hasTestId: Boolean(testId),
            hasSessionId: Boolean(sessionId),
            hasEventType: Boolean(eventType),
            hasProductId: Boolean(productId),
          },
        },
        { status: 400, headers: corsHeaders },
      );
    }

    const validEventTypes = ['IMPRESSION', 'ADD_TO_CART', 'PURCHASE'];
    if (!validEventTypes.includes(eventType)) {
      return json(
        { error: 'Invalid event type', received: eventType, valid: validEventTypes },
        { status: 400, headers: corsHeaders },
      );
    }

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

    const normalizedVariantId = normalizeVariantId(shopifyVariantId ?? null);

    const rotationSlot = await db.rotationSlot.findUnique({
      where: {
        shop_productId_shopifyVariantId: {
          shop: shopDomain!,
          productId,
          shopifyVariantId: normalizedVariantId,
        },
      },
      include: {
        variantA: true,
        variantB: true,
      },
    });

    const effectiveSlot =
      rotationSlot ||
      (await db.rotationSlot.findUnique({
        where: {
          shop_productId_shopifyVariantId: {
            shop: shopDomain!,
            productId,
            shopifyVariantId: null,
          },
        },
        include: {
          variantA: true,
          variantB: true,
        },
      }));

    if (!effectiveSlot) {
      return json(
        { error: 'Rotation slot not configured', productId, shopifyVariantId: normalizedVariantId },
        { status: 404, headers: corsHeaders },
      );
    }

    const eventTimestamp = occurredAt ? new Date(occurredAt) : new Date();
    const rotationVariant =
      (await variantAtTimestamp(effectiveSlot.id, eventTimestamp)) ?? effectiveSlot.activeVariant;

    const abVariant = mapRotationToAbVariant(effectiveSlot, rotationVariant);

    if (!abVariant) {
      return json(
        { error: 'Unable to resolve AB variant for rotation slot' },
        { status: 500, headers: corsHeaders },
      );
    }

    const duplicateEvent = await db.aBTestEvent.findFirst({
      where: {
        testId,
        sessionId,
        eventType,
      },
    });

    if (duplicateEvent) {
      return json(
        { success: true, message: 'Event already tracked' },
        { headers: corsHeaders },
      );
    }

    const createdEvent = await db.aBTestEvent.create({
      data: {
        testId,
        sessionId,
        variant: abVariant.code,
        eventType,
        productId,
        variantId: normalizedVariantId,
        revenue: revenue ? Number.parseFloat(String(revenue)) : null,
      },
    });

    return json(
      {
        success: true,
        eventId: createdEvent.id,
        variant: abVariant.code,
        rotationVariant,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return json({ error: message }, { status: 500, headers: corsHeaders });
  }
};

export function mapRotationToAbVariant(
  slot: {
    variantA: { variant: 'A' | 'B' } | null;
    variantB: { variant: 'A' | 'B' } | null;
  },
  rotationVariant: RotationVariant,
): { code: 'A' | 'B' } | null {
  if (rotationVariant === RotationVariant.CONTROL) {
    if (slot.variantA?.variant === 'A' || slot.variantA?.variant === 'B') {
      return { code: slot.variantA.variant };
    }
    return { code: 'A' };
  }

  if (slot.variantB?.variant === 'A' || slot.variantB?.variant === 'B') {
    return { code: slot.variantB.variant };
  }

  return { code: 'B' };
}

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
