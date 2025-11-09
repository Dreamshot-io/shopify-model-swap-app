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
  const sourceImageUrl = String(formData.get("sourceImageUrl") || "");
  const prompt = String(formData.get("prompt") || "");
  const productId = String(formData.get("productId") || "");
  const aspectRatio = String(formData.get("aspectRatio") || "match_input_image");

  if (!sourceImageUrl || !prompt) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing sourceImageUrl or prompt",
    };
    return json(errorResponse, { status: 400 });
  }

  try {
    const result = await generateAIImage({
      sourceImageUrl,
      prompt,
      productId,
      modelType: "swap",
      aspectRatio: aspectRatio as any,
    });

    try {
      await db.metricEvent.create({
        data: {
          id: crypto.randomUUID(),
          shop,
          eventType: "GENERATED",
          productId,
          imageUrl: result.imageUrl,
        },
      });
    } catch (loggingError) {
      console.warn("Failed to log generation event:", loggingError);
    }

    // Auto-publish to product media if admin context is available
    if (admin && productId) {
      try {
        console.log('[generation] Auto-publishing to product media...');

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
          console.warn('[generation] Auto-publish errors:', publishData.data.productCreateMedia.mediaUserErrors);
        } else if (publishData.data?.productCreateMedia?.media?.[0]) {
          console.log('[generation] ✓ Auto-published to product media:', publishData.data.productCreateMedia.media[0].id);
        }
      } catch (publishError) {
        console.warn('[generation] Auto-publish failed:', publishError);
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

    return json(successResponse);
  } catch (error: any) {
    console.error("[generation] AI image generation failed:", error);

    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: error?.message || "AI image generation failed",
      debug: { sourceImageUrl, prompt, errorType: error.constructor.name },
    };
    return json(errorResponse, { status: 500 });
  }
}
