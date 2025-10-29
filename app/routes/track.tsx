import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("[track] ===== REQUEST RECEIVED =====", {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
  });

  if (request.method !== "POST") {
    console.log("[track] Method not allowed:", request.method);
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let corsHeaders: Record<string, string> = {};
  let sessionShop: string | undefined;

  try {
    console.log("[track] Attempting authentication...");
    // CRITICAL: Add proper authentication with HMAC validation
    const { session, cors } = await authenticate.public.appProxy(request);
    sessionShop = session?.shop;
    corsHeaders = cors?.headers || {};

    console.log("[track] Authentication successful, shop:", sessionShop);

    let body;
    try {
      body = await request.json();
      console.log("[track] Body received:", {
        testId: body.testId,
        sessionId: body.sessionId?.substring(0, 20) + "...",
        eventType: body.eventType,
        productId: body.productId,
        hasVariant: !!body.variant,
      });
    } catch (parseError) {
      console.error("[track] Failed to parse JSON body:", parseError);
      return json(
        { error: "Invalid JSON body" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { testId, sessionId, eventType, revenue, productId, variant } = body;

    if (!testId || !sessionId || !eventType || !productId) {
      console.error("[track] Missing required fields:", {
        hasTestId: !!testId,
        hasSessionId: !!sessionId,
        hasEventType: !!eventType,
        hasProductId: !!productId,
      });
      return json(
        { error: "Missing required fields", details: { testId: !!testId, sessionId: !!sessionId, eventType: !!eventType, productId: !!productId } },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate event type
    const validEventTypes = ["IMPRESSION", "ADD_TO_CART", "PURCHASE"];
    if (!validEventTypes.includes(eventType)) {
      console.error("[track] Invalid event type:", eventType);
      return json(
        { error: "Invalid event type", received: eventType, valid: validEventTypes },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify test belongs to this shop
    const test = await db.aBTest.findFirst({
      where: {
        id: testId,
        shop: sessionShop,
      }
    });

    if (!test) {
      console.error("[track] Test not found:", { testId, shop: sessionShop });
      return json(
        { error: "Test not found or unauthorized", testId, shop: sessionShop },
        { status: 404, headers: corsHeaders }
      );
    }

    console.log("[track] Test found:", test.id, "status:", test.status);

    // Get the user's variant assignment from any existing event (prefer IMPRESSION)
    const existingEvent = await db.aBTestEvent.findFirst({
      where: {
        testId,
        sessionId,
      },
      orderBy: {
        createdAt: "asc", // Get the first event (should be IMPRESSION)
      },
    });

    let variantToUse: string | null = null;

    if (existingEvent) {
      variantToUse = existingEvent.variant;
      console.log("[track] Found existing event with variant:", variantToUse);
    } else {
      // If no existing event, try to use variant from request body (for ADD_TO_CART events)
      if (variant && (variant === "A" || variant === "B")) {
        variantToUse = variant;
        console.log("[track] Using variant from request body:", variantToUse);

        // Create IMPRESSION event retroactively if it doesn't exist
        try {
          await db.aBTestEvent.create({
            data: {
              testId,
              sessionId,
              variant: variantToUse,
              eventType: "IMPRESSION",
              productId,
            },
          });
          console.log("[track] Created retroactive IMPRESSION event");
        } catch (createError) {
          console.error("[track] Failed to create retroactive IMPRESSION:", createError);
        }
      } else {
        console.error("[track] No variant assignment found:", {
          testId,
          sessionId: sessionId.substring(0, 20) + "...",
          hasExistingEvent: false,
          variantFromBody: variant,
        });
        return json(
          { error: "No variant assignment found for this session", testId, sessionId: sessionId.substring(0, 20) + "..." },
          { status: 404, headers: corsHeaders }
        );
      }
    }

    if (!variantToUse) {
      console.error("[track] No variant determined");
      return json(
        { error: "Unable to determine variant" },
        { status: 400, headers: corsHeaders }
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
      console.log("[track] Duplicate event detected, skipping:", {
        eventType,
        testId,
        sessionId: sessionId.substring(0, 20) + "...",
      });
      return json(
        { success: true, message: "Event already tracked" },
        { headers: corsHeaders }
      );
    }

    // Create the tracking event
    console.log("[track] Creating event:", {
      testId,
      sessionId: sessionId.substring(0, 20) + "...",
      variant: variantToUse,
      eventType,
      productId,
    });

    const createdEvent = await db.aBTestEvent.create({
      data: {
        testId,
        sessionId,
        variant: variantToUse,
        eventType,
        productId,
        revenue: revenue ? parseFloat(revenue.toString()) : null,
      },
    });

    console.log("[track] Event created successfully:", createdEvent.id);

    return json(
      { success: true, eventId: createdEvent.id },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[track] ===== ERROR OCCURRED =====");
    console.error("[track] Error type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("[track] Error message:", error instanceof Error ? error.message : String(error));
    console.error("[track] Error stack:", error instanceof Error ? error.stack : "No stack");
    console.error("[track] Error details:", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      shop: sessionShop,
      hasCorsHeaders: Object.keys(corsHeaders).length > 0,
    });

    // Handle authentication errors
    if (error instanceof Error && (
      error.message.includes("authenticate") ||
      error.message.includes("HMAC") ||
      error.message.includes("signature")
    )) {
      console.error("[track] Authentication error detected");
      return json(
        { error: "Authentication failed", details: error.message },
        { status: 401, headers: corsHeaders }
      );
    }

    // Handle Response errors (from Remix/Shopify auth)
    if (error instanceof Response) {
      console.error("[track] Response error:", error.status, error.statusText);
      return error;
    }

    console.error("[track] Returning 500 error response");
    return json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
        type: error instanceof Error ? error.constructor.name : typeof error,
      },
      { status: 500, headers: corsHeaders }
    );
  }
};
