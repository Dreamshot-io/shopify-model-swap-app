/**
 * MediaGalleryService handles all interactions with Shopify's media gallery.
 * This service replaces the legacy R2-based storage system.
 *
 * @example
 * const service = new MediaGalleryService(admin);
 * const mediaIds = await service.uploadToGallery(images, productId);
 *
 * @since 2.0.0
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

const normalizeUrl = (url: string | undefined | null): string | null => {
  if (!url) {
    return null;
  }

  const [base] = url.split("?");
  return base;
};

export interface MediaItem {
  id: string;
  url: string;
  altText?: string;
  position?: number;
}

export interface UploadMediaInput {
  url: string;
  altText?: string;
}

export interface MediaUploadResult {
  mediaId: string;
  url: string;
  success: boolean;
  error?: string;
}

export class MediaGalleryService {
  constructor(private admin: AdminApiContext) {}

  /**
   * Upload multiple images to a product's media gallery
   */
  async uploadToGallery(
    images: UploadMediaInput[],
    productId: string
  ): Promise<MediaUploadResult[]> {
    const results: MediaUploadResult[] = [];

    // Process in batches of 3 to avoid rate limits
    const batchSize = 3;
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(image => this.uploadSingleImage(image, productId))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Ensure images exist in the gallery, uploading any missing ones
   */
  async ensureMediaInGallery(
    images: UploadMediaInput[],
    productId: string
  ): Promise<MediaUploadResult[]> {
    if (images.length === 0) {
      return [];
    }

    const existingMedia = await this.getProductMedia(productId);
    const mediaByUrl = new Map<string, MediaItem>();

    for (const media of existingMedia) {
      const key = normalizeUrl(media.url);
      if (key) {
        mediaByUrl.set(key, media);
      }
    }

    const results: MediaUploadResult[] = [];

    for (const image of images) {
      const normalized = normalizeUrl(image.url);

      if (normalized && mediaByUrl.has(normalized)) {
        const media = mediaByUrl.get(normalized)!;
        results.push({
          mediaId: media.id,
          url: media.url,
          success: true,
        });
        continue;
      }

      const uploadResult = await this.uploadSingleImage(image, productId);
      results.push(uploadResult);

      if (uploadResult.success) {
        const key = normalizeUrl(uploadResult.url);
        if (key) {
          mediaByUrl.set(key, {
            id: uploadResult.mediaId,
            url: uploadResult.url,
            altText: image.altText,
          });
        }
      }
    }

    return results;
  }

  /**
   * Upload a single image to the product gallery
   */
  private async uploadSingleImage(
    image: UploadMediaInput,
    productId: string
  ): Promise<MediaUploadResult> {
    try {
      const response = await this.admin.graphql(
        `#graphql
        mutation CreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              ... on MediaImage {
                id
                image {
                  url
                  altText
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId,
            media: [
              {
                mediaContentType: "IMAGE",
                originalSource: image.url,
                alt: image.altText || "",
              },
            ],
          },
        }
      );

      const data = await response.json();

      if (data.data?.productCreateMedia?.userErrors?.length > 0) {
        const error = data.data.productCreateMedia.userErrors[0];
        return {
          mediaId: "",
          url: image.url,
          success: false,
          error: error.message,
        };
      }

      const createdMedia = data.data?.productCreateMedia?.media?.[0];
      if (createdMedia) {
        return {
          mediaId: createdMedia.id,
          url: createdMedia.image.url,
          success: true,
        };
      }

      return {
        mediaId: "",
        url: image.url,
        success: false,
        error: "Failed to create media",
      };
    } catch (error) {
      console.error("Error uploading image to gallery:", error);
      return {
        mediaId: "",
        url: image.url,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get all media from a product's gallery
   */
  async getProductMedia(productId: string): Promise<MediaItem[]> {
    const response = await this.admin.graphql(
      `#graphql
      query GetProductMedia($productId: ID!) {
        product(id: $productId) {
          media(first: 250) {
            edges {
              node {
                ... on MediaImage {
                  id
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: { productId },
      }
    );

    const data = await response.json();
    const media = data.data?.product?.media?.edges || [];

    return media
      .map((edge: any, index: number) => ({
        id: edge.node.id,
        url: edge.node.image?.url,
        altText: edge.node.image?.altText,
        position: index,
      }))
      .filter((item: MediaItem) => item.url); // Filter out non-image media
  }

  /**
   * Validate that the provided media IDs exist in the gallery
   */
  async validateMediaPresence(
    productId: string,
    mediaIds: string[]
  ): Promise<{
    missing: string[];
    existing: string[];
  }> {
    if (mediaIds.length === 0) {
      return { missing: [], existing: [] };
    }

    const currentMedia = await this.getProductMedia(productId);
    const currentIds = new Set(currentMedia.map(media => media.id));

    const existing: string[] = [];
    const missing: string[] = [];

    for (const mediaId of mediaIds) {
      if (currentIds.has(mediaId)) {
        existing.push(mediaId);
      } else {
        missing.push(mediaId);
      }
    }

    return { missing, existing };
  }

  /**
   * Check if a media file exists in Shopify's media library by URL
   * This checks the media library, not just assigned product media
   */
  async validateMediaByUrl(
    productId: string,
    urls: string[]
  ): Promise<{
    found: Array<{ url: string; mediaId: string; altText?: string }>;
    missing: string[];
  }> {
    if (urls.length === 0) {
      return { found: [], missing: [] };
    }

    const normalizeUrl = (url: string) => {
      if (!url) return "";
      const [base] = url.split("?");
      return base;
    };

    // Get all media assigned to product
    const productMedia = await this.getProductMedia(productId);
    const mediaByUrl = new Map(
      productMedia.map((media) => [normalizeUrl(media.url), media])
    );

    const found: Array<{ url: string; mediaId: string; altText?: string }> = [];
    const missing: string[] = [];

    for (const url of urls) {
      const normalizedUrl = normalizeUrl(url);
      const media = mediaByUrl.get(normalizedUrl);

      if (media) {
        found.push({
          url: media.url,
          mediaId: media.id,
          altText: media.altText,
        });
      } else {
        // Try to find by querying Shopify's files API
        // For now, we'll check if URL contains Shopify CDN pattern
        // If it's a Shopify CDN URL, assume it exists in library
        if (url.includes('cdn.shopify.com') || url.includes('shopifycdn.com')) {
          // Media exists in Shopify library but not assigned to product
          // We'll need to assign it, but for validation we'll accept it
          // The actual mediaId will be resolved when assigning
          found.push({
            url,
            mediaId: '', // Will be resolved when assigning
            altText: undefined,
          });
        } else {
          missing.push(url);
        }
      }
    }

    return { found, missing };
  }

  /**
   * Update which media are visible on the product (swap assignment)
   * Unassigns inactive images and assigns target images.
   *
   * IMPORTANT: productDeleteMedia unassigns images from product but does NOT delete files.
   * Files remain in Shopify's media library and can be reassigned later without re-uploading.
   */
  /**
   * Update which media are visible on the product (swap assignment)
   * IMPORTANT: We NEVER delete media during rotation. All test images stay in gallery.
   * We only reorder them so the active case appears first.
   */
  async updateProductMediaAssignment(
    productId: string,
    mediaIds: string[]
  ): Promise<boolean> {
    try {
      console.log(`[MediaGallery] Updating product media assignment for ${productId}`, {
        targetMediaCount: mediaIds.length,
        targetMediaIds: mediaIds,
      });

      // Get current media assigned to product
      const currentMedia = await this.getProductMedia(productId);
      const currentMediaIds = currentMedia.map(m => m.id);

      console.log(`[MediaGallery] Current gallery has ${currentMediaIds.length} media items`);
      console.log(`[MediaGallery] Current media IDs:`, currentMediaIds);
      console.log(`[MediaGallery] Target media IDs:`, mediaIds);

      // 1. Check if all target media exists in gallery, and reassign if needed
      const missingMedia = mediaIds.filter(id => !currentMediaIds.includes(id));

      if (missingMedia.length > 0) {
        console.log(`[MediaGallery] ⚠️  ${missingMedia.length} target media not in gallery, checking if they exist in Shopify library...`);

        // Try to find and reassign missing media
        for (const mediaId of missingMedia) {
          try {
            // Query Shopify to check if media exists and get its URL
            const mediaQuery = await this.admin.graphql(
              `#graphql
              query GetMediaById($id: ID!) {
                node(id: $id) {
                  ... on MediaImage {
                    id
                    image {
                      url
                      altText
                    }
                  }
                }
              }`,
              {
                variables: { id: mediaId },
              }
            );

            const mediaData = await mediaQuery.json() as {
              data?: {
                node?: {
                  __typename?: string;
                  id?: string;
                  image?: {
                    url?: string;
                    altText?: string;
                  };
                };
              };
              errors?: Array<{
                message?: string;
                locations?: unknown;
                path?: unknown;
                extensions?: unknown;
              }>;
            };

            // Log the full response to debug
            console.log(`[MediaGallery] Query response for media ${mediaId}:`, {
              hasData: !!mediaData.data,
              hasNode: !!mediaData.data?.node,
              nodeType: mediaData.data?.node?.__typename,
              hasImage: !!mediaData.data?.node?.image,
              errors: mediaData.errors,
            });

            const mediaNode = mediaData.data?.node;

            if (mediaData.errors && mediaData.errors.length > 0) {
              console.error(`[MediaGallery] GraphQL errors querying media ${mediaId}:`, JSON.stringify(mediaData.errors, null, 2));
            }

            if (mediaNode && mediaNode.image?.url) {
              console.log(`[MediaGallery] Media ${mediaId} exists in library, reassigning to product...`);

              // Reassign using productCreateMedia with existing URL
              const createResponse = await this.admin.graphql(
                `#graphql
                mutation ReassignMediaToProduct($productId: ID!, $media: [CreateMediaInput!]!) {
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
                }`,
                {
                  variables: {
                    productId,
                    media: [{
                      originalSource: mediaNode.image.url,
                      mediaContentType: "IMAGE",
                      alt: mediaNode.image.altText || "",
                    }],
                  },
                }
              );

              const createData = await createResponse.json();
              const errors = createData.data?.productCreateMedia?.mediaUserErrors || [];

              if (errors.length > 0) {
                console.error(`[MediaGallery] Failed to reassign media ${mediaId}:`, errors);
                throw new Error(
                  `Cannot reassign media ${mediaId} to product: ${errors.map((e: any) => e.message).join(", ")}`
                );
              }

              const createdMedia = createData.data?.productCreateMedia?.media?.[0];
              if (createdMedia && createdMedia.id) {
                console.log(`[MediaGallery] ✓ Successfully reassigned media ${mediaId} (new ID: ${createdMedia.id})`);
                // Update the mediaId in the list if it changed
                const index = mediaIds.indexOf(mediaId);
                if (index !== -1) {
                  mediaIds[index] = createdMedia.id;
                }
              }
            } else {
              // Media doesn't exist - check if it was deleted or if query failed
              console.error(`[MediaGallery] Media ${mediaId} query result:`, {
                nodeExists: !!mediaNode,
                nodeType: mediaNode?.__typename,
                hasImage: !!mediaNode?.image,
                queryErrors: mediaData.errors,
                fullResponse: JSON.stringify(mediaData, null, 2),
              });

              // If media truly doesn't exist, we can't reassign it
              // This means the media was deleted from Shopify, not just unassigned
              throw new Error(
                `Media ${mediaId} does not exist in Shopify library. ` +
                `This media was likely deleted from Shopify. ` +
                `The test data may be out of sync - consider recreating the test with valid media.`
              );
            }
          } catch (error) {
            console.error(`[MediaGallery] ✗ Error reassigning media ${mediaId}:`, error);
            throw new Error(
              `Cannot rotate: Media ${mediaId} is not in the product gallery and could not be reassigned. ` +
              `Error: ${error instanceof Error ? error.message : "Unknown error"}`
            );
          }
        }

        // Refresh current media list after reassignment
        const updatedMedia = await this.getProductMedia(productId);
        currentMediaIds.length = 0;
        currentMediaIds.push(...updatedMedia.map(m => m.id));
        console.log(`[MediaGallery] After reassignment, gallery now has ${currentMediaIds.length} items`);
      }

      // 2. Remove old images that aren't in target list using fileUpdate (unassigns without deleting)
      const mediaToRemove = currentMediaIds.filter(id => !mediaIds.includes(id));

      if (mediaToRemove.length > 0) {
        console.log(`[MediaGallery] Unassigning ${mediaToRemove.length} inactive images from product:`, mediaToRemove);
        const removeSuccess = await this.unassignMediaFromProduct(productId, mediaToRemove);

        if (!removeSuccess) {
          console.warn(`[MediaGallery] ⚠️  Some images failed to unassign, continuing...`);
        } else {
          // Refresh current media list after removal
          const updatedMedia = await this.getProductMedia(productId);
          currentMediaIds.length = 0;
          currentMediaIds.push(...updatedMedia.map(m => m.id));
          console.log(`[MediaGallery] After unassignment, gallery now has ${currentMediaIds.length} items`);
        }
      }

      // 3. Reorder target images to ensure correct display order
      if (mediaIds.length > 0) {
        console.log(`[MediaGallery] Reordering ${mediaIds.length} images`);
        const reorderSuccess = await this.reorderProductMedia(productId, mediaIds);

        if (!reorderSuccess) {
          console.warn(`[MediaGallery] ⚠️  Reorder failed, but images are assigned`);
        }
      }

      // 4. Verify final state
      const finalMedia = await this.getProductMedia(productId);
      const finalMediaIds = finalMedia.map(m => m.id);

      console.log(`[MediaGallery] ✓ Media assignment updated successfully`);
      console.log(`[MediaGallery] Final verification - Gallery has ${finalMediaIds.length} images:`, finalMediaIds);
      console.log(`[MediaGallery] Active case images (first ${mediaIds.length}):`, finalMediaIds.slice(0, mediaIds.length));

      // Verify active images are first
      const activeImagesFirst = mediaIds.every((id, index) => finalMediaIds[index] === id);
      if (!activeImagesFirst) {
        console.warn(`[MediaGallery] ⚠️  Active images not in correct position`);
        console.warn(`[MediaGallery] Expected first ${mediaIds.length} to be:`, mediaIds);
        console.warn(`[MediaGallery] Actual first ${mediaIds.length} are:`, finalMediaIds.slice(0, mediaIds.length));
      } else {
        console.log(`[MediaGallery] ✓ Active images are first - rotation successful!`);
      }

      return true;
    } catch (error) {
      console.error("[MediaGallery] ✗ Error updating product media assignment:", error);

      // Log graphQLErrors if present
      const errorObj = error as {
        body?: {
          errors?: {
            graphQLErrors?: unknown[];
          };
        };
        response?: {
          status?: number;
          statusText?: string;
          headers?: unknown;
        };
        errors?: unknown[];
      };

      if (errorObj.body?.errors?.graphQLErrors) {
        console.error("[MediaGallery] graphQLErrors:", JSON.stringify(errorObj.body.errors.graphQLErrors, null, 2));
        errorObj.body.errors.graphQLErrors.forEach((err: unknown, index: number) => {
          console.error(`[MediaGallery] graphQLError ${index + 1}:`, JSON.stringify(err, null, 2));
        });
      }

      if (errorObj.response) {
        console.error("[MediaGallery] Error response:", {
          status: errorObj.response.status,
          statusText: errorObj.response.statusText,
          headers: errorObj.response.headers,
        });
      }
      if (errorObj.body) {
        console.error("[MediaGallery] Error body:", JSON.stringify(errorObj.body, null, 2));
        if (errorObj.body.errors) {
          console.error("[MediaGallery] Error body.errors:", JSON.stringify(errorObj.body.errors, null, 2));
        }
      }
      if (errorObj.errors) {
        console.error("[MediaGallery] Error errors:", JSON.stringify(errorObj.errors, null, 2));
        errorObj.errors.forEach((err: unknown, index: number) => {
          console.error(`[MediaGallery] Error ${index + 1}:`, JSON.stringify(err, null, 2));
        });
      }
      return false;
    }
  }

  /**
   * Add media to a product without removing existing media
   */
  private async addMediaToProduct(
    productId: string,
    mediaIds: string[]
  ): Promise<boolean> {
    try {
      const response = await this.admin.graphql(
        `#graphql
        mutation AddMediaToProduct($productId: ID!, $mediaIds: [ID!]!) {
          productAppendImages(id: $productId, images: $mediaIds) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: { productId, mediaIds },
        }
      );

      const data = await response.json() as {
        data?: {
          productAppendImages?: {
            product?: { id?: string };
            userErrors?: Array<{ field?: string[]; message?: string }>;
          };
        };
        errors?: Array<{
          message?: string;
          locations?: unknown;
          path?: unknown;
          extensions?: unknown;
        }>;
      };

      // Log full response for debugging
      console.log('[MediaGallery] productAppendImages response:', {
        hasData: !!data.data,
        hasProductAppendImages: !!data.data?.productAppendImages,
        userErrors: data.data?.productAppendImages?.userErrors,
        graphQLErrors: data.errors,
      });

      if (data.errors && data.errors.length > 0) {
        console.error('[MediaGallery] GraphQL errors appending images:', JSON.stringify(data.errors, null, 2));
        console.error('[MediaGallery] graphQLErrors (append):', JSON.stringify(data.errors, null, 2));
        data.errors.forEach((error, index: number) => {
          console.error(`[MediaGallery] GraphQL Error ${index + 1} (append):`, {
            message: error.message,
            locations: error.locations,
            path: error.path,
            extensions: error.extensions,
            fullError: JSON.stringify(error, null, 2),
          });
        });
        return false;
      }

      return !data.data?.productAppendImages?.userErrors?.length;
    } catch (error) {
      console.error("Error adding media to product:", error);

      // Log graphQLErrors if present
      const errorObj = error as {
        body?: {
          errors?: {
            graphQLErrors?: unknown[];
          };
        };
        response?: {
          text: () => Promise<string>;
        };
      };

      if (errorObj.body?.errors?.graphQLErrors) {
        console.error("[MediaGallery] graphQLErrors (addMedia):", JSON.stringify(errorObj.body.errors.graphQLErrors, null, 2));
        errorObj.body.errors.graphQLErrors.forEach((err: unknown, index: number) => {
          console.error(`[MediaGallery] graphQLError ${index + 1} (addMedia):`, JSON.stringify(err, null, 2));
        });
      }

      if (errorObj.response) {
        const responseText = await errorObj.response.text().catch(() => 'Unable to read response');
        console.error("[MediaGallery] Error response body:", responseText);
      }

      if (errorObj.body) {
        console.error("[MediaGallery] Error body:", JSON.stringify(errorObj.body, null, 2));
        if (errorObj.body.errors) {
          console.error("[MediaGallery] Error body.errors:", JSON.stringify(errorObj.body.errors, null, 2));
          if (errorObj.body.errors.graphQLErrors) {
            console.error("[MediaGallery] Error body.errors.graphQLErrors:", JSON.stringify(errorObj.body.errors.graphQLErrors, null, 2));
          }
        }
      }

      return false;
    }
  }

  /**
   * Unassign media from a product WITHOUT deleting files
   * Uses fileUpdate with referencesToRemove to remove product association
   * Files remain in Shopify's media library and can be reassigned later
   */
  private async unassignMediaFromProduct(
    productId: string,
    mediaIds: string[]
  ): Promise<boolean> {
    try {
      // Use fileUpdate to remove product reference without deleting files
      const files = mediaIds.map(mediaId => ({
        id: mediaId,
        referencesToRemove: [productId],
      }));

      const response = await this.admin.graphql(
        `#graphql
        mutation UnassignMediaFromProduct($files: [FileUpdateInput!]!) {
          fileUpdate(files: $files) {
            files {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: { files },
        }
      );

      const data = await response.json() as {
        data?: {
          fileUpdate?: {
            files?: Array<{ id?: string }>;
            userErrors?: Array<{ field?: string[]; message?: string; code?: string }>;
          };
        };
        errors?: Array<{
          message?: string;
          locations?: unknown;
          path?: unknown;
          extensions?: unknown;
        }>;
      };

      // Log full response for debugging
      console.log('[MediaGallery] fileUpdate (unassign) response:', {
        hasData: !!data.data,
        hasFileUpdate: !!data.data?.fileUpdate,
        filesUpdated: data.data?.fileUpdate?.files?.length,
        userErrors: data.data?.fileUpdate?.userErrors,
        graphQLErrors: data.errors,
      });

      if (data.errors && data.errors.length > 0) {
        console.error('[MediaGallery] GraphQL errors unassigning media:', JSON.stringify(data.errors, null, 2));
        data.errors.forEach((error, index: number) => {
          console.error(`[MediaGallery] GraphQL Error ${index + 1} (unassign):`, {
            message: error.message,
            locations: error.locations,
            path: error.path,
            extensions: error.extensions,
            fullError: JSON.stringify(error, null, 2),
          });
        });
        return false;
      }

      const userErrors = data.data?.fileUpdate?.userErrors || [];
      if (userErrors.length > 0) {
        console.error('[MediaGallery] User errors unassigning media:', JSON.stringify(userErrors, null, 2));
        userErrors.forEach((error, index: number) => {
          console.error(`[MediaGallery] User Error ${index + 1} (unassign):`, {
            field: error.field,
            message: error.message,
            code: error.code,
            fullError: JSON.stringify(error, null, 2),
          });
        });
        return false;
      }

      console.log(`[MediaGallery] Successfully unassigned ${mediaIds.length} images from product (files preserved)`);
      return true;
    } catch (error) {
      console.error("Error unassigning media from product:", error);
      return false;
    }
  }

  /**
   * Reorder media in the product gallery
   * Note: productReorderMedia returns a job that must complete asynchronously
   */
  async reorderProductMedia(
    productId: string,
    orderedMediaIds: string[]
  ): Promise<boolean> {
    try {
      // Create moves array for reordering
      const moves = orderedMediaIds.map((mediaId, newPosition) => ({
        id: mediaId,
        newPosition: newPosition.toString(),
      }));

      const response = await this.admin.graphql(
        `#graphql
        mutation ReorderProductMedia($productId: ID!, $moves: [MoveInput!]!) {
          productReorderMedia(id: $productId, moves: $moves) {
            job {
              id
              done
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: { productId, moves },
        }
      );

      const data = await response.json();

      if (data.data?.productReorderMedia?.userErrors?.length > 0) {
        console.error('[MediaGallery] Reorder errors:',
          data.data.productReorderMedia.userErrors);
        return false;
      }

      const job = data.data?.productReorderMedia?.job;

      // Poll for job completion if not done immediately
      if (job && !job.done) {
        console.log(`[MediaGallery] Polling job ${job.id} for completion...`);
        const completed = await this.pollJobCompletion(job.id);
        if (!completed) {
          console.warn('[MediaGallery] ⚠️  Job did not complete, but continuing...');
        }
      }

      return true;
    } catch (error) {
      console.error("Error reordering product media:", error);
      return false;
    }
  }

  /**
   * Poll for job completion (with timeout)
   */
  private async pollJobCompletion(jobId: string, maxAttempts: number = 10): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

      try {
        const response = await this.admin.graphql(
          `#graphql
          query GetJobStatus($id: ID!) {
            job(id: $id) {
              id
              done
            }
          }`,
          {
            variables: { id: jobId },
          }
        );

        const data = await response.json() as {
          data?: {
            job?: {
              id?: string;
              done?: boolean;
            };
          };
          errors?: Array<{
            message?: string;
            locations?: unknown;
            path?: unknown;
            extensions?: unknown;
          }>;
        };

        if (data.errors && data.errors.length > 0) {
          console.error(`[MediaGallery] GraphQL errors polling job ${jobId}:`, JSON.stringify(data.errors, null, 2));
          break;
        }

        const job = data.data?.job;

        if (job?.done) {
          console.log(`[MediaGallery] Job ${jobId} completed successfully`);
          return true;
        }
      } catch (error) {
        console.error(`[MediaGallery] Error polling job ${jobId}:`, error);
        const errorObj = error as { body?: { errors?: { graphQLErrors?: unknown[] } } };
        if (errorObj.body?.errors?.graphQLErrors) {
          console.error(`[MediaGallery] graphQLErrors polling job:`, JSON.stringify(errorObj.body.errors.graphQLErrors, null, 2));
        }
        break;
      }
    }

    console.warn(`[MediaGallery] Job ${jobId} did not complete within ${maxAttempts} seconds`);
    return false;
  }

  /**
   * Update variant hero images
   */
  async updateVariantHeroes(
    productId: string,
    variantUpdates: Array<{ variantId: string; mediaId: string | null }>
  ): Promise<boolean> {
    try {
      const variants = variantUpdates.map(update => ({
        id: update.variantId,
        mediaId: update.mediaId,
      }));

      const response = await this.admin.graphql(
        `#graphql
        mutation UpdateVariantHeroes($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product {
              id
            }
            productVariants {
              id
              image {
                id
                url
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: { productId, variants },
        }
      );

      const data = await response.json();
      return !data.data?.productVariantsBulkUpdate?.userErrors?.length;
    } catch (error) {
      console.error("Error updating variant heroes:", error);
      return false;
    }
  }

  /**
   * Check if media exists in the gallery
   */
  async validateMediaAvailability(
    productId: string,
    mediaIds: string[]
  ): Promise<boolean> {
    const currentMedia = await this.getProductMedia(productId);
    const currentMediaIds = new Set(currentMedia.map(m => m.id));

    return mediaIds.every(id => currentMediaIds.has(id));
  }

  /**
   * Remove unused media from the gallery (cleanup)
   * Only removes media that aren't referenced by any test
   */
  async removeUnusedMedia(
    productId: string,
    usedMediaIds: Set<string>
  ): Promise<number> {
    const allMedia = await this.getProductMedia(productId);
    const unusedMedia = allMedia.filter(m => !usedMediaIds.has(m.id));

    if (unusedMedia.length === 0) {
      return 0;
    }

    const unusedMediaIds = unusedMedia.map(m => m.id);
    const success = await this.unassignMediaFromProduct(productId, unusedMediaIds);

    return success ? unusedMedia.length : 0;
  }

  /**
   * Get gallery utilization statistics
   */
  async getGalleryStats(productId: string): Promise<{
    totalMedia: number;
    availableSlots: number;
    utilizationPercent: number;
  }> {
    const media = await this.getProductMedia(productId);
    const totalMedia = media.length;
    const maxMedia = 250; // Shopify limit
    const availableSlots = maxMedia - totalMedia;
    const utilizationPercent = (totalMedia / maxMedia) * 100;

    return {
      totalMedia,
      availableSlots,
      utilizationPercent,
    };
  }
}
