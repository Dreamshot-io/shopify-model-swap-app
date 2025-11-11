/**
 * Emergency Recovery Script for Lost Base Images
 *
 * This script restores base images that were accidentally deleted due to the
 * canSafelyDeleteMedia bug that compared mediaIds instead of URLs.
 *
 * It uses the permanentUrls stored in R2 to restore the images.
 */

import { type AdminApiContext } from '@shopify/shopify-app-remix/server';
import db from '../db.server';
import { uploadR2ImageToShopify, isPrivateR2Url } from './shopify-image-upload.server';

interface ImageData {
  url: string;
  mediaId?: string;
  permanentUrl?: string;
  position: number;
  altText?: string;
}

export class BaseImageRecoveryService {
  /**
   * Recover base images for a specific test
   */
  static async recoverBaseImages(
    admin: AdminApiContext,
    testId: string
  ): Promise<{ success: boolean; imagesRecovered: number; error?: string }> {
    try {
      console.log(`[Recovery] Starting recovery for test ${testId}`);

      // Get the test with base images
      const test = await db.aBTest.findUnique({
        where: { id: testId },
      });

      if (!test) {
        return { success: false, imagesRecovered: 0, error: 'Test not found' };
      }

      const baseImages = test.baseImages as unknown as ImageData[];
      if (!baseImages || baseImages.length === 0) {
        return { success: false, imagesRecovered: 0, error: 'No base images found in database' };
      }

      // Check if product currently has images
      const currentMediaQuery = `
        query getProductMedia($productId: ID!) {
          product(id: $productId) {
            id
            title
            media(first: 100) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const currentMediaResponse = await admin.graphql(currentMediaQuery, {
        variables: { productId: test.productId },
      });

      const currentMediaData = await currentMediaResponse.json();
      const currentMedia = currentMediaData.data?.product?.media?.edges || [];

      console.log(`[Recovery] Product currently has ${currentMedia.length} images`);
      console.log(`[Recovery] Database has ${baseImages.length} base images to restore`);

      // If product already has images, be careful
      if (currentMedia.length > 0) {
        const confirmRestore = test.currentCase === 'BASE' && currentMedia.length < baseImages.length;
        if (!confirmRestore) {
          return {
            success: false,
            imagesRecovered: 0,
            error: `Product already has ${currentMedia.length} images. Manual verification needed.`
          };
        }
      }

      // Restore each base image that has a permanentUrl
      let imagesRecovered = 0;
      const errors: string[] = [];

      for (const image of baseImages) {
        if (!image.permanentUrl) {
          console.warn(`[Recovery] Image at position ${image.position} has no permanentUrl, skipping`);
          errors.push(`Position ${image.position}: No backup URL`);
          continue;
        }

        try {
          console.log(`[Recovery] Restoring image ${image.position} from ${image.permanentUrl}`);

          // Check if it's a private R2 URL that needs to be uploaded to Shopify
          let uploadUrl = image.permanentUrl;
          if (isPrivateR2Url(uploadUrl)) {
            console.log(`[Recovery] Converting R2 URL to Shopify CDN...`);
            uploadUrl = await uploadR2ImageToShopify(
              admin,
              image.permanentUrl,
              image.altText || `Recovered image ${image.position}`
            );
          }

          // Create the media in Shopify
          const createMediaMutation = `
            mutation createProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
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

          const createResponse = await admin.graphql(createMediaMutation, {
            variables: {
              productId: test.productId,
              media: [{
                originalSource: uploadUrl,
                alt: image.altText || '',
                mediaContentType: 'IMAGE',
              }],
            },
          });

          const createData = await createResponse.json();

          if (createData.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
            const error = createData.data.productCreateMedia.mediaUserErrors[0].message;
            console.error(`[Recovery] Failed to restore image ${image.position}: ${error}`);
            errors.push(`Position ${image.position}: ${error}`);
          } else {
            const newMediaId = createData.data?.productCreateMedia?.media?.[0]?.id;
            if (newMediaId) {
              console.log(`[Recovery] ✅ Restored image ${image.position} with new mediaId: ${newMediaId}`);
              imagesRecovered++;

              // Update the base image with new mediaId
              baseImages[image.position].mediaId = newMediaId;
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Recovery] Error restoring image ${image.position}:`, errorMsg);
          errors.push(`Position ${image.position}: ${errorMsg}`);
        }
      }

      // Update the database with new mediaIds
      if (imagesRecovered > 0) {
        await db.aBTest.update({
          where: { id: testId },
          data: {
            baseImages: JSON.parse(JSON.stringify(baseImages)),
          },
        });
        console.log(`[Recovery] Updated database with new mediaIds`);
      }

      console.log(`[Recovery] Recovery complete: ${imagesRecovered}/${baseImages.length} images restored`);

      return {
        success: imagesRecovered > 0,
        imagesRecovered,
        error: errors.length > 0 ? `Some images failed: ${errors.join('; ')}` : undefined,
      };
    } catch (error) {
      console.error('[Recovery] Fatal error:', error);
      return {
        success: false,
        imagesRecovered: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Recover all tests that might have lost their base images
   */
  static async recoverAllAffectedTests(
    admin: AdminApiContext,
    shop: string
  ): Promise<{ totalTests: number; recovered: number; failed: number }> {
    console.log(`[Recovery] Starting recovery for all tests in shop ${shop}`);

    // Find all active tests that are currently showing BASE
    const affectedTests = await db.aBTest.findMany({
      where: {
        shop,
        status: 'ACTIVE',
        currentCase: 'BASE',
      },
    });

    console.log(`[Recovery] Found ${affectedTests.length} tests to check`);

    let recovered = 0;
    let failed = 0;

    for (const test of affectedTests) {
      const result = await this.recoverBaseImages(admin, test.id);
      if (result.success) {
        recovered++;
        console.log(`[Recovery] ✅ Test ${test.name}: Recovered ${result.imagesRecovered} images`);
      } else {
        failed++;
        console.log(`[Recovery] ❌ Test ${test.name}: ${result.error}`);
      }
    }

    return {
      totalTests: affectedTests.length,
      recovered,
      failed,
    };
  }
}