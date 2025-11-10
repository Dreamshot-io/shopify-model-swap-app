import { json } from "@remix-run/node";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db from "../../../db.server";
import { generateAIImage } from "../../../services/ai-providers.server";
import type {
  GenerateImageResponse,
  ActionErrorResponse,
} from "../types";

export async function handleGenerate(
  formData: FormData,
  shop: string,
  admin?: AdminApiContext,
) {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[HANDLER:${requestId}] handleGenerate called for shop: ${shop}`);

  const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
  const prompt = String(formData.get("prompt") || "");
  const productId = String(formData.get("productId") || "");
  const aspectRatio = String(formData.get("aspectRatio") || "match_input_image");

  console.log(`[HANDLER:${requestId}] Parsed inputs:`, {
    sourceImageUrl: sourceImageUrl ? sourceImageUrl.substring(0, 50) + '...' : 'missing',
    prompt: prompt ? prompt.substring(0, 50) + '...' : 'missing',
    productId: productId || 'missing',
    aspectRatio,
    hasAdmin: !!admin,
  });

  if (!sourceImageUrl || !prompt) {
    console.error(`[HANDLER:${requestId}] Validation failed: missing sourceImageUrl or prompt`);
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing sourceImageUrl or prompt",
    };
    return json(errorResponse, { status: 400 });
  }

  try {
    console.log(`[HANDLER:${requestId}] Calling generateAIImage...`);
    const result = await generateAIImage({
      sourceImageUrl,
      prompt,
      productId,
      modelType: "swap",
      aspectRatio: aspectRatio as any,
    });
    console.log(`[HANDLER:${requestId}] generateAIImage succeeded:`, {
      hasImageUrl: !!result.imageUrl,
      imageUrl: result.imageUrl ? result.imageUrl.substring(0, 50) + '...' : 'missing',
      id: result.id,
    });

    try {
      console.log(`[HANDLER:${requestId}] Logging metric event...`);
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          eventType: "GENERATED",
          productId,
          imageUrl: result.imageUrl,
        },
      });
      console.log(`[HANDLER:${requestId}] Metric event logged`);
    } catch (loggingError) {
      console.warn(`[HANDLER:${requestId}] Failed to log generation event:`, loggingError);
    }

    // Auto-publish to product media if admin context is available
    if (admin && productId) {
      try {
        console.log(`[HANDLER:${requestId}] Auto-publishing to product media...`);

        const publishMutation = `
          mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media {
                ... on MediaImage {
                  id
                  image {
                    url
                  }
                }
              }
              mediaUserErrors {
                field
                message
              }
            }
          }
        `;

        const publishResponse = await admin.graphql(publishMutation, {
          variables: {
            productId,
            media: [{
              originalSource: result.imageUrl,
              mediaContentType: "IMAGE",
              alt: `AI generated: ${prompt.substring(0, 50)}`,
            }],
          },
        });

        const publishData = await publishResponse.json();

        if (publishData.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
          console.warn(`[HANDLER:${requestId}] Auto-publish errors:`, publishData.data.productCreateMedia.mediaUserErrors);
        } else if (publishData.data?.productCreateMedia?.media?.[0]) {
          console.log(`[HANDLER:${requestId}] ✓ Auto-published to product media:`, publishData.data.productCreateMedia.media[0].id);
        }
      } catch (publishError) {
        console.warn(`[HANDLER:${requestId}] Auto-publish failed:`, publishError);
        // Don't fail the generation if auto-publish fails
      }
    }

    const successResponse: GenerateImageResponse = {
      ok: true,
      result: {
        ...result,
        originalSource: sourceImageUrl,
      },
    };

    console.log(`[HANDLER:${requestId}] Returning success response`);
    return json(successResponse);
  } catch (error: any) {
    console.error(`[HANDLER:${requestId}] AI image generation failed:`, {
      message: error?.message,
      stack: error?.stack,
      name: error?.constructor?.name,
      error,
    });

    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error?.message || "AI image generation failed",
      debug: { sourceImageUrl, prompt, errorType: error.constructor.name },
    };
    return json(errorResponse, { status: 500 });
  }
}
