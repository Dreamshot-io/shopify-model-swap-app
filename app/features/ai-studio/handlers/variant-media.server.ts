import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { json } from "@remix-run/node";
import type { ActionErrorResponse } from "../types";

/**
 * Assign an image to specific product variants
 *
 * Process:
 * 1. Create media on product using productCreateMedia
 * 2. Get mediaId from response
 * 3. Use productVariantAppendMedia to assign media to each variant
 */
export async function assignImageToVariants(
  admin: AdminApiContext,
  productId: string,
  imageUrl: string,
  variantIds: string[],
): Promise<{
  success: boolean;
  mediaId?: string;
  errors?: string[];
}> {
  try {
    console.log("[VARIANT_MEDIA] Starting assignment:", {
      productId,
      imageUrl: imageUrl.substring(0, 50) + "...",
      variantCount: variantIds.length,
    });

    // Step 1: Create media on product
    const createMediaMutation = `#graphql
      mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            id
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
            code
          }
        }
      }
    `;

    const createResponse = await admin.graphql(createMediaMutation, {
      variables: {
        productId,
        media: [
          {
            originalSource: imageUrl,
            mediaContentType: "IMAGE",
            alt: "AI generated image",
          },
        ],
      },
    });

    const createJson = await createResponse.json();

    // Check for errors in media creation
    const mediaErrors = createJson?.data?.productCreateMedia?.mediaUserErrors || [];
    if (mediaErrors.length > 0) {
      console.error("[VARIANT_MEDIA] Media creation errors:", mediaErrors);
      return {
        success: false,
        errors: mediaErrors.map((e: any) => e.message),
      };
    }

    const createdMedia = createJson?.data?.productCreateMedia?.media?.[0];
    if (!createdMedia) {
      console.error("[VARIANT_MEDIA] No media created");
      return {
        success: false,
        errors: ["Failed to create media on product"],
      };
    }

    const mediaId = createdMedia.id;
    console.log("[VARIANT_MEDIA] Media created:", mediaId);

    // Step 2: If no variants specified, we're done (product-level only)
    if (!variantIds || variantIds.length === 0) {
      console.log("[VARIANT_MEDIA] No variants specified, product-level media only");
      return {
        success: true,
        mediaId,
      };
    }

    // Step 3: Assign media to each variant
    const assignmentErrors: string[] = [];

    for (const variantId of variantIds) {
      const appendMediaMutation = `#graphql
        mutation ProductVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
          productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
            product {
              id
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `;

      const appendResponse = await admin.graphql(appendMediaMutation, {
        variables: {
          productId,
          variantMedia: [
            {
              variantId,
              mediaIds: [mediaId],
            },
          ],
        },
      });

      const appendJson = await appendResponse.json();
      const appendErrors = appendJson?.data?.productVariantAppendMedia?.userErrors || [];

      if (appendErrors.length > 0) {
        console.error(`[VARIANT_MEDIA] Failed to assign media to variant ${variantId}:`, appendErrors);
        assignmentErrors.push(
          `Variant ${variantId}: ${appendErrors.map((e: any) => e.message).join(", ")}`
        );
      } else {
        console.log(`[VARIANT_MEDIA] Successfully assigned media to variant ${variantId}`);
      }
    }

    if (assignmentErrors.length > 0) {
      console.warn("[VARIANT_MEDIA] Some variant assignments failed:", assignmentErrors);
      return {
        success: true, // Media was created, so partial success
        mediaId,
        errors: assignmentErrors,
      };
    }

    console.log("[VARIANT_MEDIA] All variant assignments successful");
    return {
      success: true,
      mediaId,
    };
  } catch (error: any) {
    console.error("[VARIANT_MEDIA] Unexpected error:", error);
    return {
      success: false,
      errors: [error.message || "Unexpected error during variant media assignment"],
    };
  }
}

/**
 * Handler for publishing images with variant assignment
 */
export async function handlePublishWithVariants(
  formData: FormData,
  admin: AdminApiContext,
  shop: string,
) {
  const imageUrl = String(formData.get("imageUrl") || "");
  const productId = String(formData.get("productId") || "");
  const variantIdsJson = String(formData.get("variantIds") || "");

  if (!imageUrl || !productId) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: "Missing imageUrl or productId",
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse variant IDs if provided
  let variantIds: string[] = [];
  if (variantIdsJson) {
    try {
      const parsed = JSON.parse(variantIdsJson);
      variantIds = Array.isArray(parsed) ? parsed : [];
    } catch {
      variantIds = [];
    }
  }

  // Assign image to product and variants
  const result = await assignImageToVariants(admin, productId, imageUrl, variantIds);

  if (!result.success) {
    const errorResponse: ActionErrorResponse = {
      ok: false,
      error: result.errors?.[0] || "Failed to publish image",
    };
    return json(errorResponse, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return success with optional warnings
  return json(
    {
      ok: true,
      published: true,
      mediaId: result.mediaId,
      warnings: result.errors, // Partial failures
    },
    { headers: { "Content-Type": "application/json" } }
  );
}
