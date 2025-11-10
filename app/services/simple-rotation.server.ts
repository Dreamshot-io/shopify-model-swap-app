import { type ABTest } from '@prisma/client';
import db from '../db.server';
import { AuditService } from './audit.server';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import { storeImagePermanently, getSafeImageUrl } from './image-storage.server';
import { uploadR2ImageToShopify, isPrivateR2Url } from './shopify-image-upload.server';

interface ImageData {
  url: string;
  mediaId?: string;
  permanentUrl?: string; // Our CDN URL for restoration
  position: number;
  altText?: string;
}

interface RotationResult {
  success: boolean;
  duration: number;
  imagesUpdated: number;
  variantsUpdated: number;
}

export class SimpleRotationService {
  /**
   * Main rotation function - swaps between BASE and TEST images
   */
  static async rotateTest(
    testId: string,
    triggeredBy: 'CRON' | 'MANUAL' | 'SYSTEM' = 'SYSTEM',
    userId?: string,
    admin?: AdminApiContext
  ): Promise<RotationResult> {
    const startTime = Date.now();

    // Get test with variants
    const test = await db.aBTest.findUnique({
      where: { id: testId },
      include: { variants: true },
    });

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    if (test.status !== 'ACTIVE') {
      throw new Error(`Test ${testId} is not active (status: ${test.status})`);
    }

    const targetCase = test.currentCase === 'BASE' ? 'TEST' : 'BASE';

    // Log rotation start
    await AuditService.logRotationStarted(
      testId,
      test.shop,
      test.currentCase,
      targetCase,
      triggeredBy,
      userId
    );

    try {
      let imagesUpdated = 0;
      let variantsUpdated = 0;

      // If admin context not provided, we need to get it
      // This would be passed from the route that calls this service
      if (!admin) {
        throw new Error('Admin context required for rotation');
      }

      // Rotate product gallery images
      const baseImages = (test.baseImages as unknown as ImageData[]) || [];
      const galleryImages = targetCase === 'BASE'
        ? baseImages
        : (test.testImages as unknown as ImageData[]);

      console.log(`[rotateTest] Target case: ${targetCase}`);
      console.log(`[rotateTest] Gallery images count:`, galleryImages.length);
      if (galleryImages.length > 0) {
        console.log(`[rotateTest] First image:`, {
          url: galleryImages[0].url?.substring(0, 50),
          hasMediaId: !!galleryImages[0].mediaId,
          hasPermanentUrl: !!galleryImages[0].permanentUrl,
          permanentUrl: galleryImages[0].permanentUrl?.substring(0, 50),
        });
      }

      if (galleryImages && galleryImages.length > 0) {
        const updateResult = await this.updateProductMedia(
          admin,
          test.productId,
          galleryImages,
          baseImages,
          targetCase === 'BASE'
        );
        imagesUpdated = updateResult.addedCount + updateResult.keptCount;

        // Update database with refreshed media IDs
        if (targetCase === 'BASE') {
          await db.aBTest.update({
            where: { id: testId },
            data: {
              baseImages: galleryImages, // Now has updated mediaIds
            },
          });
        } else {
          await db.aBTest.update({
            where: { id: testId },
            data: {
              testImages: galleryImages, // Now has updated mediaIds
            },
          });
        }

        // Log gallery update
        await AuditService.logImagesUploaded(
          testId,
          test.shop,
          updateResult.addedCount,
          galleryImages.map(img => img.mediaId || img.url),
          targetCase,
          userId
        );
      }

      // Rotate variant hero images if any
      for (const variant of test.variants) {
        const heroImage = targetCase === 'BASE'
          ? (variant.baseHeroImage as unknown as ImageData | null)
          : (variant.testHeroImage as unknown as ImageData);

        console.log(`[Rotation] Variant ${variant.variantName}: heroImage=`, heroImage);

        // Handle both setting and removing heroes
        if (heroImage) {
          // Set/update hero image
          console.log(`[Rotation] Setting hero for variant ${variant.variantName}`);
          await this.updateVariantHero(admin, variant.shopifyVariantId, heroImage, test.productId, testId);
          variantsUpdated++;

          // Update database with media ID
          if (targetCase === 'BASE') {
            await db.aBTestVariant.update({
              where: { id: variant.id },
              data: {
                baseHeroImage: heroImage, // Now has updated mediaId
              },
            });
          } else {
            await db.aBTestVariant.update({
              where: { id: variant.id },
              data: {
                testHeroImage: heroImage, // Now has updated mediaId
              },
            });
          }

          // Log variant update
          await AuditService.logVariantHeroUpdated(
            testId,
            test.shop,
            variant.shopifyVariantId,
            variant.variantName,
            heroImage.mediaId || heroImage.url,
            targetCase,
            userId
          );
        } else {
          // Remove hero image (base case had no hero)
          console.log(`[Rotation] Removing hero for variant ${variant.variantName}`);
          await this.removeVariantHero(admin, variant.shopifyVariantId, test.productId, testId);
          variantsUpdated++;

          // Log variant hero removal
          await AuditService.logVariantHeroUpdated(
            testId,
            test.shop,
            variant.shopifyVariantId,
            variant.variantName,
            'removed',
            targetCase,
            userId
          );
        }
      }

      // Update test state
      const nextRotation = new Date();
      nextRotation.setTime(nextRotation.getTime() + test.rotationHours * 3600000);

      await db.aBTest.update({
        where: { id: testId },
        data: {
          currentCase: targetCase,
          lastRotation: new Date(),
          nextRotation,
        },
      });

      const duration = Date.now() - startTime;

      // Log successful rotation
      await AuditService.logRotationCompleted(
        testId,
        test.shop,
        test.currentCase,
        targetCase,
        duration,
        { imagesUpdated, variantsUpdated }
      );

      // Create rotation event for attribution
      await AuditService.createRotationEvent(
        testId,
        test.currentCase,
        targetCase,
        triggeredBy,
        true,
        duration,
        userId,
        undefined,
        { imagesUpdated, variantsUpdated }
      );

      return {
        success: true,
        duration,
        imagesUpdated,
        variantsUpdated,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log failure
      await AuditService.logRotationFailed(
        testId,
        test.shop,
        test.currentCase,
        targetCase,
        error as Error,
        userId
      );

      // Create failed rotation event
      await AuditService.createRotationEvent(
        testId,
        test.currentCase,
        targetCase,
        triggeredBy,
        false,
        duration,
        userId,
        (error as Error).message,
        { stack: (error as Error).stack }
      );

      throw error;
    }
  }

  /**
   * Smart product gallery update with permanent storage backup
   * Deletes and recreates as needed, using R2 backup URLs for base images
   */
  private static async updateProductMedia(
    admin: AdminApiContext,
    productId: string,
    targetImages: ImageData[],
    baseImages: ImageData[],
    isRotatingToBase: boolean
  ): Promise<{ addedCount: number; deletedCount: number; keptCount: number }> {
    // STEP 1: Query current product media
    const currentMediaQuery = `
      query getProductMedia($productId: ID!) {
        product(id: $productId) {
          id
          media(first: 100) {
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
      }
    `;

    console.log(`[updateProductMedia] Querying product media for:`, productId);

    const currentMediaResponse = await admin.graphql(currentMediaQuery, {
      variables: { productId },
    });

    const currentMediaData = await currentMediaResponse.json();
    console.log(`[updateProductMedia] Current media count:`, currentMediaData.data?.product?.media?.edges?.length || 0);

    const currentMedia = (currentMediaData.data?.product?.media?.edges || [])
      .filter((edge: any) => edge.node.image) // Filter out non-images
      .map((edge: any, index: number) => ({
        url: edge.node.image.url,
        mediaId: edge.node.id,
        position: index,
        altText: edge.node.image.altText || '',
      }));

    // STEP 2: Determine what to keep, add, and delete
    const currentMediaMap = new Map(
      currentMedia.map(img => [img.url.split('?')[0].toLowerCase(), img])
    );
    const targetMediaMap = new Map(
      targetImages.map(img => [img.url.split('?')[0].toLowerCase(), img])
    );

    const toDelete: string[] = [];
    const toKeep: ImageData[] = [];
    const toAdd: ImageData[] = [];

    // Find what to keep (images in both current and target)
    for (const currentImg of currentMedia) {
      const normalizedUrl = currentImg.url.split('?')[0].toLowerCase();

      if (targetMediaMap.has(normalizedUrl)) {
        // Image is in target - keep it and reuse media ID
        const targetImg = targetMediaMap.get(normalizedUrl)!;
        toKeep.push({
          ...targetImg,
          mediaId: currentImg.mediaId, // Reuse existing media ID
        });
      } else {
        // Image not in target - delete it
        // Safe to delete base images now because we have R2 backups
        if (currentImg.mediaId) {
          toDelete.push(currentImg.mediaId);
        }
      }
    }

    // Find what to add (images in target but not in current)
    for (const [url, targetImg] of targetMediaMap.entries()) {
      if (!currentMediaMap.has(url)) {
        toAdd.push(targetImg);
      } else {
        // Already handled in toKeep
      }
    }

    console.log(`[updateProductMedia] To keep: ${toKeep.length}, To add: ${toAdd.length}, To delete: ${toDelete.length}`);

    // STEP 3: Delete images not in target (safe now that we have R2 backups)
    if (toDelete.length > 0) {
      console.log(`[updateProductMedia] Deleting media IDs:`, toDelete);
      const deleteQuery = `
        mutation deleteMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            userErrors {
              field
              message
            }
          }
        }
      `;

      const deleteResult = await admin.graphql(deleteQuery, {
        variables: {
          productId,
          mediaIds: toDelete,
        },
      });

      const deleteData = await deleteResult.json();
      if (deleteData.data?.productDeleteMedia?.userErrors?.length > 0) {
        console.error('[updateProductMedia] Deletion errors:', deleteData.data.productDeleteMedia.userErrors);
      }
    }

    // STEP 4: Create missing images
    if (toAdd.length > 0) {
      console.log(`[updateProductMedia] Adding ${toAdd.length} new images`);
      for (const image of toAdd) {
        const createQuery = `
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
              userErrors {
                field
                message
              }
            }
          }
        `;

        // Use permanent URL if available, otherwise use original URL
        let sourceUrl = getSafeImageUrl(image);
        console.log(`[updateProductMedia] Creating image from:`, sourceUrl);

        // Check if this is a private R2 URL that needs transfer
        if (isPrivateR2Url(sourceUrl)) {
          console.log(`[updateProductMedia] Detected private R2 URL, uploading via staged upload...`);
          try {
            sourceUrl = await uploadR2ImageToShopify(
              admin,
              sourceUrl,
              `product-${productId}-img-${image.position}`
            );
            console.log(`[updateProductMedia] ✓ Uploaded to Shopify CDN:`, sourceUrl);
          } catch (uploadError) {
            console.error('[updateProductMedia] Failed to upload R2 image:', uploadError);
            throw new Error(`Failed to transfer R2 image to Shopify: ${(uploadError as Error).message}`);
          }
        }

        const createResult = await admin.graphql(createQuery, {
          variables: {
            productId,
            media: [{
              originalSource: sourceUrl,
              alt: image.altText || '',
              mediaContentType: 'IMAGE',
            }],
          },
        });

        const createData = await createResult.json();
        if (createData.data?.productCreateMedia?.userErrors?.length > 0) {
          console.error('[updateProductMedia] Create errors:', createData.data.productCreateMedia.userErrors);
          throw new Error(
            `Failed to create media: ${JSON.stringify(createData.data.productCreateMedia.userErrors)}`
          );
        }

        const newMediaId = createData.data?.productCreateMedia?.media?.[0]?.id;
        if (newMediaId) {
          image.mediaId = newMediaId;
          console.log(`[updateProductMedia] Created media:`, newMediaId);
        }
      }
    }

    return {
      addedCount: toAdd.length,
      deletedCount: toDelete.length,
      keptCount: toKeep.length,
    };
  }

  /**
   * Smart variant hero update with deduplication and cleanup
   * Checks if image already exists before creating, removes old hero
   */
  private static async updateVariantHero(
    admin: AdminApiContext,
    variantId: string,
    heroImage: ImageData,
    productId?: string,
    testId?: string
  ): Promise<void> {
    // Get product ID - either passed or query from variant
    let productGid = productId;

    if (!productGid) {
      const variantQuery = `
        query getVariantProduct($variantId: ID!) {
          productVariant(id: $variantId) {
            product {
              id
            }
          }
        }
      `;

      const variantResponse = await admin.graphql(variantQuery, {
        variables: { variantId },
      });

      const variantData = await variantResponse.json();
      productGid = variantData.data?.productVariant?.product?.id;

      if (!productGid) {
        throw new Error(`Could not find product for variant: ${variantId}`);
      }
    }

    // STEP 0: Query current variant to get old hero image
    const currentVariantQuery = `
      query getCurrentVariantHero($variantId: ID!) {
        productVariant(id: $variantId) {
          id
          image {
            id
            url
          }
        }
      }
    `;

    const currentVariantResponse = await admin.graphql(currentVariantQuery, {
      variables: { variantId },
    });

    const currentVariantData = await currentVariantResponse.json();
    const oldHeroMediaId = currentVariantData.data?.productVariant?.image?.id;
    const oldHeroUrl = currentVariantData.data?.productVariant?.image?.url;

    // STEP 1: Check if hero image already exists in product media
    const mediaQuery = `
      query getProductMedia($productId: ID!) {
        product(id: $productId) {
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

    const mediaResponse = await admin.graphql(mediaQuery, {
      variables: { productId: productGid },
    });

    const mediaData = await mediaResponse.json();
    const productMedia = mediaData.data?.product?.media?.edges || [];

    // Check if our hero image already exists
    const normalizedHeroUrl = heroImage.url.split('?')[0].toLowerCase();
    const existingMedia = productMedia.find((edge: any) => {
      // Skip if not an image (could be video, etc.)
      if (!edge.node.image || !edge.node.image.url) return false;
      const normalizedMediaUrl = edge.node.image.url.split('?')[0].toLowerCase();
      return normalizedMediaUrl === normalizedHeroUrl;
    });

    let mediaIdToAttach: string;

    if (existingMedia) {
      // Reuse existing media
      mediaIdToAttach = existingMedia.node.id;
    } else {
      // Create new media
      const createMediaQuery = `
        mutation createProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media {
              ... on MediaImage {
                id
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Use permanent URL if available, otherwise original URL
      let sourceUrl = getSafeImageUrl(heroImage);
      console.log(`[updateVariantHero] Creating hero image from:`, sourceUrl);

      // Check if this is a private R2 URL that needs transfer
      if (isPrivateR2Url(sourceUrl)) {
        console.log(`[updateVariantHero] Detected private R2 URL, uploading via staged upload...`);
        try {
          sourceUrl = await uploadR2ImageToShopify(
            admin,
            sourceUrl,
            `variant-${variantId}-hero`
          );
          console.log(`[updateVariantHero] ✓ Uploaded to Shopify CDN:`, sourceUrl);
        } catch (uploadError) {
          console.error('[updateVariantHero] Failed to upload R2 image:', uploadError);
          throw new Error(`Failed to transfer R2 hero image to Shopify: ${(uploadError as Error).message}`);
        }
      }

      const createResult = await admin.graphql(createMediaQuery, {
        variables: {
          productId: productGid,
          media: [{
            originalSource: sourceUrl,
            alt: heroImage.altText || '',
            mediaContentType: 'IMAGE',
          }],
        },
      });

      const createData = await createResult.json();
      if (createData.data?.productCreateMedia?.userErrors?.length > 0) {
        throw new Error(
          `Failed to create variant media: ${JSON.stringify(createData.data.productCreateMedia.userErrors)}`
        );
      }

      mediaIdToAttach = createData.data?.productCreateMedia?.media?.[0]?.id;
      if (!mediaIdToAttach) {
        throw new Error('Failed to get media ID after creation');
      }
    }

    // STEP 2: Attach media to variant
    const attachQuery = `
      mutation updateVariantImage($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(
          productId: $productId,
          variants: $variants
        ) {
          productVariants {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const attachResult = await admin.graphql(attachQuery, {
      variables: {
        productId: productGid,
        variants: [{
          id: variantId,
          mediaId: mediaIdToAttach,
        }],
      },
    });

    const attachData = await attachResult.json();
    if (attachData.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
      throw new Error(
        `Failed to attach media to variant: ${JSON.stringify(attachData.data.productVariantsBulkUpdate.userErrors)}`
      );
    }

    // STEP 3: Clean up old hero if it exists and is safe to remove
    if (oldHeroMediaId && oldHeroUrl && testId) {
      const shouldDeleteOldHero = await this.canSafelyDeleteMedia(
        admin,
        productGid!,
        oldHeroMediaId,
        oldHeroUrl,
        testId,
        variantId
      );

      if (shouldDeleteOldHero) {
        try {
          const deleteQuery = `
            mutation deleteMedia($productId: ID!, $mediaIds: [ID!]!) {
              productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
                deletedMediaIds
              }
            }
          `;

          await admin.graphql(deleteQuery, {
            variables: {
              productId: productGid,
              mediaIds: [oldHeroMediaId],
            },
          });
        } catch (error) {
          // Log but don't fail - cleanup is optional
          console.error('Failed to clean up old variant hero:', error);
        }
      }
    }

    // Update heroImage with mediaId for future reference
    heroImage.mediaId = mediaIdToAttach;
  }

  /**
   * Remove variant hero image and clean up if safe
   */
  private static async removeVariantHero(
    admin: AdminApiContext,
    variantId: string,
    productId: string,
    testId: string
  ): Promise<void> {
    // STEP 1: Query current variant hero
    const currentVariantQuery = `
      query getCurrentVariantHero($variantId: ID!) {
        productVariant(id: $variantId) {
          id
          image {
            id
            url
          }
        }
      }
    `;

    const currentVariantResponse = await admin.graphql(currentVariantQuery, {
      variables: { variantId },
    });

    const currentVariantData = await currentVariantResponse.json();
    const oldHeroMediaId = currentVariantData.data?.productVariant?.image?.id;
    const oldHeroUrl = currentVariantData.data?.productVariant?.image?.url;

    // STEP 2: Detach hero from variant
    // We'll delete the old media first, which will automatically remove it from the variant
    // This is actually safer than trying to explicitly detach

    // STEP 3: Clean up old hero if safe to delete
    if (oldHeroMediaId && oldHeroUrl) {
      console.log(`[removeVariantHero] Checking if can delete old hero:`, { oldHeroMediaId, oldHeroUrl });

      const shouldDelete = await this.canSafelyDeleteMedia(
        admin,
        productId,
        oldHeroMediaId,
        oldHeroUrl,
        testId,
        variantId
      );

      console.log(`[removeVariantHero] Should delete?`, shouldDelete);

      if (shouldDelete) {
        try {
          console.log(`[removeVariantHero] Deleting media ID:`, oldHeroMediaId);

          const deleteQuery = `
            mutation deleteMedia($productId: ID!, $mediaIds: [ID!]!) {
              productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
                deletedMediaIds
              }
            }
          `;

          const deleteResult = await admin.graphql(deleteQuery, {
            variables: {
              productId,
              mediaIds: [oldHeroMediaId],
            },
          });

          const deleteData = await deleteResult.json();
          console.log(`[removeVariantHero] Delete result:`, deleteData);
        } catch (error) {
          console.error('[removeVariantHero] Failed to delete old hero image:', error);
        }
      } else {
        console.log(`[removeVariantHero] NOT deleting - image is used elsewhere`);
      }
    } else {
      console.log(`[removeVariantHero] No old hero to remove`);
    }
  }

  /**
   * Check if a media can be safely deleted
   * Returns false if the media is used in gallery images or by other variants
   */
  private static async canSafelyDeleteMedia(
    admin: AdminApiContext,
    productId: string,
    mediaId: string,
    mediaUrl: string,
    testId: string,
    excludeVariantId: string
  ): Promise<boolean> {
    // Get test data to check if image is in gallery
    const test = await db.aBTest.findUnique({
      where: { id: testId },
      include: { variants: true },
    });

    if (!test) {
      console.log(`[canSafelyDelete] Test not found:`, testId);
      return false;
    }

    const normalizedUrl = mediaUrl.split('?')[0].toLowerCase();
    console.log(`[canSafelyDelete] Checking URL:`, normalizedUrl);

    // Check if URL is in base or test gallery images
    const baseImages = Array.isArray(test.baseImages) ? test.baseImages as any[] : [];
    const testImages = Array.isArray(test.testImages) ? test.testImages as any[] : [];

    console.log(`[canSafelyDelete] Base images count:`, baseImages.length);
    console.log(`[canSafelyDelete] Test images count:`, testImages.length);

    const isInGallery = [...baseImages, ...testImages].some((img: any) => {
      const imgUrl = img?.url || img;
      const imgNormalized = imgUrl.split('?')[0].toLowerCase();
      const matches = imgNormalized === normalizedUrl;
      if (matches) {
        console.log(`[canSafelyDelete] Found in gallery:`, imgUrl);
      }
      return matches;
    });

    if (isInGallery) {
      console.log(`[canSafelyDelete] NOT safe - used in gallery`);
      return false;
    }

    // Check if any other variant uses this hero
    const usedByOtherVariant = test.variants.some((v) => {
      if (v.shopifyVariantId === excludeVariantId) return false; // Skip current variant

      const baseHero = v.baseHeroImage as any;
      const testHero = v.testHeroImage as any;

      const baseUrl = baseHero?.url || '';
      const testUrl = testHero?.url || '';

      const baseMatch = baseUrl && baseUrl.split('?')[0].toLowerCase() === normalizedUrl;
      const testMatch = testUrl && testUrl.split('?')[0].toLowerCase() === normalizedUrl;

      if (baseMatch || testMatch) {
        console.log(`[canSafelyDelete] Used by other variant:`, v.variantName);
      }

      return baseMatch || testMatch;
    });

    if (usedByOtherVariant) {
      console.log(`[canSafelyDelete] NOT safe - used by other variant`);
      return false;
    }

    // Safe to delete
    console.log(`[canSafelyDelete] SAFE to delete`);
    return true;
  }

  /**
   * Get all active tests due for rotation
   */
  static async getTestsDueForRotation(): Promise<ABTest[]> {
    const now = new Date();
    return await db.aBTest.findMany({
      where: {
        status: 'ACTIVE',
        nextRotation: {
          lte: now,
        },
      },
      include: {
        variants: true,
      },
    });
  }

  /**
   * Start a test (activate rotation)
   */
  static async startTest(testId: string, userId?: string): Promise<void> {
    const test = await db.aBTest.findUnique({
      where: { id: testId },
    });

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    // Set next rotation time
    const nextRotation = new Date();
    nextRotation.setTime(nextRotation.getTime() + test.rotationHours * 3600000);

    await db.aBTest.update({
      where: { id: testId },
      data: {
        status: 'ACTIVE',
        nextRotation,
        currentCase: 'BASE', // Always start with BASE
      },
    });

    await AuditService.logTestStatusChange(
      testId,
      test.shop,
      test.status,
      'ACTIVE',
      userId
    );
  }

  /**
   * Pause a test and restore base images
   */
  static async pauseTest(
    testId: string,
    userId?: string,
    admin?: AdminApiContext
  ): Promise<void> {
    const test = await db.aBTest.findUnique({
      where: { id: testId },
      include: { variants: true },
    });

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    // Restore base images if currently showing test
    if (test.currentCase === 'TEST' && admin) {
      try {
        await this.rotateTest(testId, 'SYSTEM', userId, admin);
      } catch (error) {
        console.error('Failed to restore base images on pause:', error);
        // Continue with pause even if rotation fails
      }
    }

    await db.aBTest.update({
      where: { id: testId },
      data: {
        status: 'PAUSED',
        nextRotation: null,
        currentCase: 'BASE', // Ensure base case is active
      },
    });

    await AuditService.logTestStatusChange(
      testId,
      test.shop,
      test.status,
      'PAUSED',
      userId
    );
  }

  /**
   * Complete a test and restore base images
   */
  static async completeTest(
    testId: string,
    admin: AdminApiContext,
    userId?: string
  ): Promise<void> {
    const test = await db.aBTest.findUnique({
      where: { id: testId },
      include: { variants: true },
    });

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    // Restore base images if currently showing test
    if (test.currentCase === 'TEST') {
      await this.rotateTest(testId, 'SYSTEM', userId, admin);
    }

    // Mark as completed
    await db.aBTest.update({
      where: { id: testId },
      data: {
        status: 'COMPLETED',
        nextRotation: null,
      },
    });

    await AuditService.logTestStatusChange(
      testId,
      test.shop,
      test.status,
      'COMPLETED',
      userId
    );
  }

  /**
   * Get rotation state for a product (used by tracking pixel)
   */
  static async getRotationState(
    productId: string
  ): Promise<{ testId: string | null; activeCase: string | null }> {
    const test = await db.aBTest.findFirst({
      where: {
        productId,
        status: 'ACTIVE',
      },
    });

    if (!test) {
      return { testId: null, activeCase: null };
    }

    return {
      testId: test.id,
      activeCase: test.currentCase,
    };
  }

  /**
   * Capture current product images as base case
   * Downloads and stores images permanently to our CDN
   */
  static async captureBaseImages(
    admin: AdminApiContext,
    productId: string
  ): Promise<ImageData[]> {
    const query = `
      query getProductImages($productId: ID!) {
        product(id: $productId) {
          id
          handle
          media(first: 100) {
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
      }
    `;

    const response = await admin.graphql(query, {
      variables: { productId },
    });

    const data = await response.json();
    const product = data.data?.product;
    const media = product?.media?.edges || [];

    console.log(`[captureBaseImages] Capturing ${media.length} images for product ${product?.handle}`);

    // Download and store each image permanently
    const capturedImages: ImageData[] = [];

    for (const [index, edge] of media.entries()) {
      const shopifyUrl = edge.node.image.url;
      const mediaId = edge.node.id;
      const altText = edge.node.image.altText;

      try {
        // Download and upload to our permanent storage
        const productHandle = product?.handle || 'product';
        const filename = `${productHandle}-base-${index}`;

        console.log(`[captureBaseImages] Storing image ${index + 1}/${media.length}`);
        const permanentUrl = await storeImagePermanently(shopifyUrl, filename);

        capturedImages.push({
          url: shopifyUrl, // Keep original for reference
          permanentUrl, // Our permanent backup URL
          mediaId,
          position: index,
          altText,
        });

        console.log(`[captureBaseImages] ✓ Stored image ${index + 1}: ${permanentUrl}`);
      } catch (error) {
        console.error(`[captureBaseImages] Failed to store image ${index}:`, error);
        // Fallback: store without permanent URL (will have issues on deletion)
        capturedImages.push({
          url: shopifyUrl,
          mediaId,
          position: index,
          altText,
        });
      }
    }

    console.log(`[captureBaseImages] Captured ${capturedImages.length} images with ${capturedImages.filter(i => i.permanentUrl).length} permanent URLs`);

    return capturedImages;
  }

  /**
   * Capture current variant hero images
   */
  static async captureVariantHeroImages(
    admin: AdminApiContext,
    productId: string,
    variantIds: string[]
  ): Promise<Map<string, ImageData | null>> {
    const query = `
      query getProductVariants($productId: ID!) {
        product(id: $productId) {
          id
          variants(first: 100) {
            edges {
              node {
                id
                displayName
                image {
                  id
                  url
                  altText
                }
              }
            }
          }
        }
      }
    `;

    const response = await admin.graphql(query, {
      variables: { productId },
    });

    const data = await response.json();
    const variants = data.data?.product?.variants?.edges || [];
    const heroImages = new Map<string, ImageData | null>();

    for (const edge of variants) {
      if (variantIds.includes(edge.node.id)) {
        if (edge.node.image) {
          heroImages.set(edge.node.id, {
            url: edge.node.image.url,
            mediaId: edge.node.image.id, // NOW CAPTURING MEDIA ID
            altText: edge.node.image.altText,
            position: 0,
          });
        } else {
          heroImages.set(edge.node.id, null);
        }
      }
    }

    return heroImages;
  }
}
