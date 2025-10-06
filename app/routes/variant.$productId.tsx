import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // CRITICAL: Add proper authentication with HMAC validation
  try {
    const { session, cors } = await authenticate.public.appProxy(request);

    // Fallback CORS headers if cors object is undefined
    const corsHeaders = cors?.headers || {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session");
    const forcedVariant = url.searchParams.get("force")?.toUpperCase(); // Get forced variant (A or B)
    const productId = params.productId
      ? decodeURIComponent(params.productId)
      : undefined;

    console.log("[variant] Request received:", {
      productId,
      sessionId: sessionId?.substring(0, 20) + "...",
      shop: session?.shop,
      hasSession: !!session,
      hasCors: !!cors,
      forcedVariant: forcedVariant || "none",
    });

    if (!sessionId || !productId) {
      console.error("[variant] Missing required params:", {
        sessionId: !!sessionId,
        productId: !!productId,
      });
      return json(
        { error: "Missing session or productId" },
        { status: 400, headers: corsHeaders },
      );
    }

    if (!session?.shop) {
      console.error("[variant] No shop in session");
      return json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders },
      );
    }

    // Find active A/B test for this product and shop
    const activeTest = await db.aBTest.findFirst({
      where: {
        productId: productId!,
        shop: session.shop, // Verified via app proxy
        status: "RUNNING",
      },
      include: {
        variants: true,
      },
    });

    console.log("[variant] Active test query result:", {
      found: !!activeTest,
      testId: activeTest?.id,
      variantCount: activeTest?.variants.length,
      productId,
      shop: session.shop,
    });

    if (!activeTest || activeTest.variants.length !== 2) {
      return json({ variant: null }, { headers: corsHeaders });
    }

    let selectedVariant: string;
    let existingEvent = null;

    // Check for forced variant (for testing/debugging)
    if (forcedVariant && (forcedVariant === "A" || forcedVariant === "B")) {
      selectedVariant = forcedVariant;
      console.log("[variant] 🔧 Using forced variant:", selectedVariant);
    } else {
      // Check if user already has a variant assigned
      existingEvent = await db.aBTestEvent.findFirst({
        where: {
          testId: activeTest.id,
          sessionId,
        },
      });

      if (existingEvent) {
        // Use existing variant assignment
        selectedVariant = existingEvent.variant;
      } else {
        // Assign new variant based on traffic split
        const random = Math.random() * 100;
        selectedVariant = random < activeTest.trafficSplit ? "A" : "B";
      }
    }

    const variantData = activeTest.variants.find(
      (v) => v.variant === selectedVariant,
    );

    console.log(
      "[variant] Looking for variant:",
      selectedVariant,
      "Available variants:",
      activeTest.variants.map((v) => v.variant),
    );

    if (!variantData) {
      console.error(
        "[variant] Variant not found:",
        selectedVariant,
        "Available:",
        activeTest.variants,
      );
      return json(
        { error: "Variant not found" },
        { status: 404, headers: corsHeaders },
      );
    }

    // Parse image URLs
    let imageUrls: string[];
    try {
      imageUrls = JSON.parse(variantData.imageUrls);
      console.log("[variant] Parsed image URLs:", imageUrls.length, "images");
    } catch (parseError) {
      console.error("[variant] Failed to parse imageUrls:", parseError);
      imageUrls = [variantData.imageUrls]; // Fallback to single URL
    }

    // Track impression if this is a new session (but not for forced variants)
    if (!existingEvent && !forcedVariant) {
      try {
        await db.aBTestEvent.create({
          data: {
            testId: activeTest.id,
            sessionId,
            variant: selectedVariant,
            eventType: "IMPRESSION",
            productId,
          },
        });
        console.log(
          "[variant] Impression tracked for variant:",
          selectedVariant,
        );
      } catch (dbError) {
        console.error("[variant] Failed to track impression:", dbError);
        // Don't fail the request if tracking fails
      }
    } else if (forcedVariant) {
      console.log("[variant] Skipping impression tracking for forced variant");
    }

    return json(
      {
        variant: selectedVariant,
        imageUrls,
        testId: activeTest.id,
      },
      {
        headers: corsHeaders, // Use Shopify's CORS headers or fallback
      },
    );
  } catch (error) {
    // If Shopify auth throws a Response (e.g., 401 invalid/missing HMAC), return it
    if (error instanceof Response) {
      console.error(
        "[variant] Auth response error:",
        error.status,
        error.statusText,
      );
      return error;
    }

    console.error("[variant] Unhandled error:", error);
    console.error(
      "[variant] Error stack:",
      error instanceof Error ? error.stack : "No stack",
    );
    console.error("[variant] Error details:", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });

    return json({ error: "Internal server error" }, { status: 500 });
  }
};
