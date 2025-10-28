import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface AbAttributePayload {
  testId: string;
  variant: string;
  productId?: string;
  sessionId?: string;
  assignedAt?: string;
}

function parseAbAttribute(raw: unknown): AbAttributePayload | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.testId === "string" &&
      typeof parsed.variant === "string"
    ) {
      return {
        testId: parsed.testId,
        variant: parsed.variant,
        productId: typeof parsed.productId === "string" ? parsed.productId : undefined,
        sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
        assignedAt: typeof parsed.assignedAt === "string" ? parsed.assignedAt : undefined,
      } satisfies AbAttributePayload;
    }

    return null;
  } catch (error) {
    console.error("[orders-paid] Failed to parse AB attribute", error);
    return null;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (!payload || typeof payload !== "object") {
    console.warn("[orders-paid] Missing payload", { topic, shop });
    return json({ ok: true });
  }

  try {
    const order = payload as Record<string, unknown>;
    const attributes = Array.isArray(order.note_attributes)
      ? (order.note_attributes as Array<Record<string, unknown>>)
      : [];

    const abAttribute = attributes.find((attr) => attr?.name === "ModelSwapAB");
    const meta = parseAbAttribute(abAttribute?.value);

    if (!meta) {
      console.log("[orders-paid] No A/B metadata on order", {
        orderId: order.id,
        shop,
      });
      return json({ ok: true });
    }

    const lineItems = Array.isArray(order.line_items)
      ? (order.line_items as Array<Record<string, unknown>>)
      : [];

    const revenue = lineItems.reduce((acc, item) => {
      if (item && typeof item === "object") {
        const price = Number((item as Record<string, unknown>).price ?? 0);
        const quantity = Number((item as Record<string, unknown>).quantity ?? 0);

        if (!Number.isNaN(price) && !Number.isNaN(quantity)) {
          return acc + price * quantity;
        }
      }

      return acc;
    }, 0);

    const test = await db.aBTest.findFirst({
      where: {
        id: meta.testId,
        shop,
        status: {
          in: ["RUNNING", "PAUSED", "COMPLETED"],
        },
      },
    });

    if (!test) {
      console.warn("[orders-paid] AB test not found or unauthorized", {
        testId: meta.testId,
        shop,
      });
      return json({ ok: true });
    }

    const sessionId = meta.sessionId || `order:${order.id}`;

    const duplicate = await db.aBTestEvent.findFirst({
      where: {
        testId: meta.testId,
        sessionId,
        eventType: "PURCHASE",
      },
    });

    if (duplicate) {
      console.log("[orders-paid] Purchase already recorded", {
        testId: meta.testId,
        sessionId,
      });
      return json({ ok: true });
    }

    await db.aBTestEvent.create({
      data: {
        testId: meta.testId,
        sessionId,
        variant: meta.variant === "B" ? "B" : "A",
        eventType: "PURCHASE",
        productId: meta.productId || test.productId,
        revenue,
      },
    });

    console.log("[orders-paid] Purchase event recorded", {
      testId: meta.testId,
      sessionId,
      revenue,
    });

    return json({ ok: true });
  } catch (error) {
    console.error("[orders-paid] Handler failed", error);
    return json({ ok: false }, { status: 500 });
  }
};
