import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { RotationVariant } from '@prisma/client';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { variantAtTimestamp } from '../services/ab-test-rotation.store';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');
  const shopifyVariantId = normalizeVariantId(url.searchParams.get('variantId'));

  if (!productId) {
    return json({ error: 'Missing productId' }, { status: 400 });
  }

  try {
    const { session, cors } = await authenticate.public.appProxy(request);
    const corsHeaders = cors?.headers || {};

    const slot = await findRotationSlot(session.shop, productId, shopifyVariantId);

    if (!slot) {
      return json(
        { activeVariant: null, abVariant: null, testId: null },
        { headers: corsHeaders },
      );
    }

    const now = new Date();
    const rotationVariant = (await variantAtTimestamp(slot.id, now)) ?? slot.activeVariant;
    const abVariant = mapRotationToAbVariant(slot.variantA?.variant, slot.variantB?.variant, rotationVariant);

    return json(
      {
        slotId: slot.id,
        rotationVariant,
        abVariant,
        testId: slot.testId,
        lastSwitchAt: slot.lastSwitchAt,
        nextSwitchDueAt: slot.nextSwitchDueAt,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return json({ error: message }, { status: 500 });
  }
};

async function findRotationSlot(shop: string, productId: string, variantId: string | null) {
  const exact = await db.rotationSlot.findUnique({
    where: {
      shop_productId_shopifyVariantId: {
        shop,
        productId,
        shopifyVariantId: variantId,
      },
    },
    include: {
      variantA: true,
      variantB: true,
    },
  });

  if (exact) return exact;

  return db.rotationSlot.findUnique({
    where: {
      shop_productId_shopifyVariantId: {
        shop,
        productId,
        shopifyVariantId: null,
      },
    },
    include: {
      variantA: true,
      variantB: true,
    },
  });
}

function mapRotationToAbVariant(
  variantA: 'A' | 'B' | undefined,
  variantB: 'A' | 'B' | undefined,
  rotationVariant: RotationVariant,
): 'A' | 'B' {
  if (rotationVariant === RotationVariant.CONTROL) {
    return variantA ?? 'A';
  }

  return variantB ?? 'B';
}

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
