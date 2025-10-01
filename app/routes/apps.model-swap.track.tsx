import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { testId, sessionId, eventType, revenue, productId } = body;

    if (!testId || !sessionId || !eventType || !productId) {
      return json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate event type
    const validEventTypes = ["IMPRESSION", "ADD_TO_CART", "PURCHASE"];
    if (!validEventTypes.includes(eventType)) {
      return json(
        { error: "Invalid event type" },
        { status: 400 }
      );
    }

    // Get the user's variant assignment
    const existingEvent = await db.aBTestEvent.findFirst({
      where: {
        testId,
        sessionId,
      },
    });

    if (!existingEvent) {
      return json(
        { error: "No variant assignment found for this session" },
        { status: 404 }
      );
    }

    // Prevent duplicate events of the same type for the same session
    const duplicateEvent = await db.aBTestEvent.findFirst({
      where: {
        testId,
        sessionId,
        eventType,
      },
    });

    if (duplicateEvent) {
      return json({ success: true, message: "Event already tracked" });
    }

    // Create the tracking event
    await db.aBTestEvent.create({
      data: {
        testId,
        sessionId,
        variant: existingEvent.variant,
        eventType,
        productId,
        revenue: revenue ? parseFloat(revenue.toString()) : null,
      },
    });

    return json({ success: true });
  } catch (error) {
    console.error("Error tracking A/B test event:", error);
    return json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
};