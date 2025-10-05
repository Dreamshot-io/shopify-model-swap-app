import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // CRITICAL: Add proper authentication with HMAC validation
  try {
    const { session, cors } = await authenticate.public.appProxy(request);

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session");
    const productId = params.productId;

    if (!sessionId || !productId) {
      return json(
        { error: "Missing session or productId" },
        { status: 400, headers: cors.headers }
      );
    }

    // Find active A/B test for this product and shop
    const activeTest = await db.aBTest.findFirst({
      where: {
        productId,
        shop: session?.shop, // Add shop verification
        status: "RUNNING",
      },
      include: {
        variants: true,
      },
    });

    if (!activeTest || activeTest.variants.length !== 2) {
      return json(
        { variant: null },
        { headers: cors.headers }
      );
    }

    // Check if user already has a variant assigned
    const existingEvent = await db.aBTestEvent.findFirst({
      where: {
        testId: activeTest.id,
        sessionId,
      },
    });

    let selectedVariant: string;
    
    if (existingEvent) {
      // Use existing variant assignment
      selectedVariant = existingEvent.variant;
    } else {
      // Assign new variant based on traffic split
      const random = Math.random() * 100;
      selectedVariant = random < activeTest.trafficSplit ? "A" : "B";
    }

    const variantData = activeTest.variants.find(v => v.variant === selectedVariant);

    if (!variantData) {
      return json(
        { error: "Variant not found" },
        { status: 404, headers: cors.headers }
      );
    }

    // Parse image URLs
    let imageUrls: string[];
    try {
      imageUrls = JSON.parse(variantData.imageUrls);
    } catch {
      imageUrls = [variantData.imageUrls]; // Fallback to single URL
    }

    // Track impression if this is a new session
    if (!existingEvent) {
      await db.aBTestEvent.create({
        data: {
          testId: activeTest.id,
          sessionId,
          variant: selectedVariant,
          eventType: "IMPRESSION",
          productId,
        },
      });
    }

    return json({
      variant: selectedVariant,
      imageUrls,
      testId: activeTest.id,
    }, {
      headers: cors.headers // Use Shopify's CORS headers
    });
  } catch (error) {
    console.error("Error in variant endpoint:", error);

    // Handle authentication errors
    if (error instanceof Error && error.message.includes("authenticate")) {
      return json(
        { error: "Authentication failed" },
        { status: 401 }
      );
    }

    return json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
};