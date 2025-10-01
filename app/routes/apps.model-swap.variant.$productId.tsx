import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const productId = params.productId;

  if (!sessionId || !productId) {
    return json(
      { error: "Missing session or productId" },
      { status: 400 }
    );
  }

  try {
    // Find active A/B test for this product
    const activeTest = await db.aBTest.findFirst({
      where: {
        productId,
        status: "RUNNING",
      },
      include: {
        variants: true,
      },
    });

    if (!activeTest || activeTest.variants.length !== 2) {
      return json({ variant: null });
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
      return json({ error: "Variant not found" }, { status: 404 });
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
    });
  } catch (error) {
    console.error("Error in variant endpoint:", error);
    return json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
};