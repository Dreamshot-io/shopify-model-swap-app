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

      // STEP 1: Capture current Shopify state (get fresh IDs)
      console.log(`[rotateTest] Step 1: Capturing current state for product ${test.productId}`);
      const variantIds = test.variants.map(v => v.shopifyVariantId);
      const currentState = await this.captureCurrentState(admin, test.productId, variantIds);

      // STEP 2: Build target state with deduplication
      console.log(`[rotateTest] Step 2: Building target state for ${targetCase}`);
      const targetState = await this.buildTargetState(test, targetCase, currentState);

      // STEP 3: Execute rotation using unified media registry
      console.log(`[rotateTest] Step 3: Executing rotation with ${targetState.mediaRegistry.size} unique media items`);

      // Track all media operations for verification
      const mediaOperations = {
        uploaded: new Map<string, string>(), // permanentUrl -> new mediaId
        reused: new Map<string, string>(),   // permanentUrl -> existing mediaId
        deleted: new Set<string>(),          // deleted mediaIds
      };

      // 3a. Delete media not in target
      const mediaToDelete = currentState.galleryMedia.filter(
        current => this.canSafelyDeleteMedia(current.mediaId, currentState, targetState)
      );

      for (const media of mediaToDelete) {
        console.log(`[rotateTest] Deleting media ${media.mediaId}`);
        await this.deleteProductMedia(admin, test.productId, media.mediaId);
        mediaOperations.deleted.add(media.mediaId);
      }

      // 3b. Process each unique media item from registry
      for (const [normalizedUrl, mediaItem] of targetState.mediaRegistry) {
        const existingMedia = currentState.galleryMedia.find(
          m => this.normalizeUrl(m.url) === normalizedUrl
        );

        let mediaId: string;

        if (existingMedia) {
          // Reuse existing media
          console.log(`[rotateTest] Reusing existing media ${existingMedia.mediaId}`);
          mediaId = existingMedia.mediaId;
          mediaOperations.reused.set(mediaItem.permanentUrl || mediaItem.url, mediaId);
        } else {
          // Upload new media
          console.log(`[rotateTest] Uploading new media from ${mediaItem.permanentUrl || mediaItem.url}`);
          const safeUrl = getSafeImageUrl({
            permanentUrl: mediaItem.permanentUrl,
            url: mediaItem.url,
          } as ImageData);

          mediaId = await this.uploadMediaToProduct(admin, test.productId, safeUrl, mediaItem.altText);
          mediaOperations.uploaded.set(mediaItem.permanentUrl || mediaItem.url, mediaId);
        }

        // Update mediaId in the registry for later use
        mediaItem.mediaId = mediaId;
      }

      // 3c. Update product media order to match target gallery
      if (targetState.targetGallery.length > 0) {
        const orderedMediaIds = targetState.targetGallery.map(img => {
          const key = this.normalizeUrl(img.permanentUrl || img.url);
          const registryItem = targetState.mediaRegistry.get(key);
          return registryItem?.mediaId;
        }).filter(Boolean) as string[];

        if (orderedMediaIds.length > 0) {
          await this.reorderProductMedia(admin, test.productId, orderedMediaIds);
        }

        imagesUpdated = targetState.targetGallery.length;
      }

      // 3d. Update variant hero images
      for (const [variantId, heroImage] of targetState.targetVariantHeros) {
        if (heroImage) {
          const key = this.normalizeUrl(heroImage.permanentUrl || heroImage.url);
          const registryItem = targetState.mediaRegistry.get(key);

          if (registryItem?.mediaId) {
            console.log(`[rotateTest] Setting hero for variant ${variantId} with media ${registryItem.mediaId}`);
            await this.attachMediaToVariant(admin, variantId, registryItem.mediaId);
            variantsUpdated++;
          }
        } else {
          // Remove hero if no target hero
          console.log(`[rotateTest] Removing hero for variant ${variantId}`);
          await this.removeVariantHero(admin, variantId, test.productId, testId);
          variantsUpdated++;
        }
      }

      // STEP 4: Verify rotation and update database with fresh IDs
      console.log(`[rotateTest] Step 4: Verifying rotation and updating database`);
      const postState = await this.captureCurrentState(admin, test.productId, variantIds);

      // Update database with fresh media IDs from post-rotation state
      const baseImages = (test.baseImages as unknown as ImageData[]) || [];
      const testImages = (test.testImages as unknown as ImageData[]) || [];

      // Update IDs based on what we just uploaded/reused
      const updateImageIds = (images: ImageData[]) => {
        return images.map(img => {
          const permanentUrl = img.permanentUrl || img.url;
          const newMediaId = mediaOperations.uploaded.get(permanentUrl) ||
                           mediaOperations.reused.get(permanentUrl);

          if (newMediaId) {
            return {
              ...img,
              mediaId: newMediaId,
            };
          }
          return img;
        });
      };

      // Update variant hero IDs
      for (const variant of test.variants) {
        const baseHero = variant.baseHeroImage as unknown as ImageData | null;
        const testHero = variant.testHeroImage as unknown as ImageData | null;

        if (baseHero) {
          const permanentUrl = baseHero.permanentUrl || baseHero.url;
          const newMediaId = mediaOperations.uploaded.get(permanentUrl) ||
                           mediaOperations.reused.get(permanentUrl);
          if (newMediaId) {
            baseHero.mediaId = newMediaId;
          }
        }

        if (testHero) {
          const permanentUrl = testHero.permanentUrl || testHero.url;
          const newMediaId = mediaOperations.uploaded.get(permanentUrl) ||
                           mediaOperations.reused.get(permanentUrl);
          if (newMediaId) {
            testHero.mediaId = newMediaId;
          }
        }

        // Update variant in database
        await db.aBTestVariant.update({
          where: { id: variant.id },
          data: {
            baseHeroImage: baseHero ? JSON.parse(JSON.stringify(baseHero)) : null,
            testHeroImage: testHero ? JSON.parse(JSON.stringify(testHero)) : null,
          },
        });
      }

      // Update test with refreshed IDs
      const nextRotation = new Date();
      nextRotation.setTime(nextRotation.getTime() + test.rotationHours * 3600000);

      await db.aBTest.update({
        where: { id: testId },
        data: {
          currentCase: targetCase,
          lastRotation: new Date(),
          nextRotation,
          baseImages: JSON.parse(JSON.stringify(updateImageIds(baseImages))),
          testImages: JSON.parse(JSON.stringify(updateImageIds(testImages))),
        },
      });

      const duration = Date.now() - startTime;

      // Log successful rotation with verification metadata
      const verificationMetadata = {
        imagesUpdated,
        variantsUpdated,
        preRotationState: {
          galleryCount: currentState.galleryMedia.length,
          variantHeroCount: Array.from(currentState.variantAssignments.values())
            .filter(v => v.heroMediaId).length,
        },
        postRotationState: {
          galleryCount: postState.galleryMedia.length,
          variantHeroCount: Array.from(postState.variantAssignments.values())
            .filter(v => v.heroMediaId).length,
        },
        operations: {
          uploaded: mediaOperations.uploaded.size,
          reused: mediaOperations.reused.size,
          deleted: mediaOperations.deleted.size,
        },
      };

      await AuditService.logRotationCompleted(
        testId,
        test.shop,
        test.currentCase,
        targetCase,
        duration,
        verificationMetadata
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
        verificationMetadata
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
      const shouldDeleteOldHero = await this.canSafelyDeleteMediaAsync(
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

      const shouldDelete = await this.canSafelyDeleteMediaAsync(
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
  private static async canSafelyDeleteMediaAsync(
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
    const baseImages = Array.isArray(test.baseImages) ? test.baseImages as unknown as ImageData[] : [];
    const testImages = Array.isArray(test.testImages) ? test.testImages as unknown as ImageData[] : [];

    console.log(`[canSafelyDelete] Base images count:`, baseImages.length);
    console.log(`[canSafelyDelete] Test images count:`, testImages.length);

    const isInGallery = [...baseImages, ...testImages].some((img: ImageData) => {
      const imgUrl = img?.url || '';
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

      const baseHero = v.baseHeroImage as unknown as ImageData | null;
      const testHero = v.testHeroImage as unknown as ImageData | null;

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
      const imageNode = edge?.node?.image;
      if (!imageNode?.url) {
        console.warn(`[captureBaseImages] Skipping media index ${index}: missing image URL`, {
          mediaId: edge?.node?.id,
        });
        continue;
      }

      const shopifyUrl = imageNode.url;
      const mediaId = edge.node.id;
      const altText = imageNode.altText;

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
          handle
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
    const product = data.data?.product;
    const variants = product?.variants?.edges || [];
    const heroImages = new Map<string, ImageData | null>();
    const errors: Array<{ variantId: string; error: string }> = [];

    console.log(`[captureVariantHeroImages] Capturing hero images for ${variantIds.length} variants`);

    for (const edge of variants) {
      if (variantIds.includes(edge.node.id)) {
        if (edge.node.image) {
          const shopifyUrl = edge.node.image.url;
          const mediaId = edge.node.image.id;
          const altText = edge.node.image.altText;
          const variantId = edge.node.id;

          try {
            // Download and upload to permanent storage (same as base images)
            const productHandle = product?.handle || 'product';
            const variantGid = variantId.split('/').pop();
            const filename = `${productHandle}-variant-${variantGid}-hero`;

            console.log(`[captureVariantHeroImages] Storing hero image for variant ${edge.node.displayName}`);
            const permanentUrl = await storeImagePermanently(shopifyUrl, filename);

            heroImages.set(variantId, {
              url: shopifyUrl,           // Keep original for reference
              permanentUrl,              // Our permanent backup URL for restoration
              mediaId,                   // Current Shopify media ID
              altText,
              position: 0,
            });

            console.log(`[captureVariantHeroImages] ✓ Stored hero image for variant: ${permanentUrl}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[captureVariantHeroImages] Failed to store hero image for variant ${variantId}:`, error);
            errors.push({ variantId, error: errorMessage });
            // Don't add to heroImages - fail fast instead of partial capture
          }
        } else {
          heroImages.set(edge.node.id, null);
        }
      }
    }

    // Fail fast if any hero images couldn't be stored permanently
    if (errors.length > 0) {
      const errorSummary = errors.map(e => `Variant ${e.variantId}: ${e.error}`).join('; ');
      const errorMessage = `Failed to capture ${errors.length} variant hero image(s) permanently. Errors: ${errorSummary}`;

      // Log audit entry for incomplete capture
      try {
        await AuditService.logApiError(
          product?.handle || 'unknown',
          'captureVariantHeroImages',
          new Error(errorMessage)
        );
      } catch (auditError) {
        console.error('[captureVariantHeroImages] Failed to log audit entry:', auditError);
      }

      throw new Error(errorMessage);
    }

    const capturedCount = Array.from(heroImages.values()).filter(img => img && img.permanentUrl).length;
    console.log(`[captureVariantHeroImages] Captured ${capturedCount} variant hero images with permanent URLs`);

    return heroImages;
  }

  /**
   * Capture the current state of product media and variant assignments
   * This provides a snapshot of the actual Shopify state before rotation
   */
  static async captureCurrentState(
    admin: AdminApiContext,
    productId: string,
    variantIds: string[]
  ): Promise<{
    galleryMedia: Array<{
      mediaId: string;
      url: string;
      position: number;
      altText?: string;
    }>;
    variantAssignments: Map<string, {
      variantId: string;
      displayName: string;
      heroMediaId: string | null;
      heroUrl: string | null;
    }>;
  }> {
    // Query both gallery and variant data in one request
    const query = `
      query getProductState($productId: ID!) {
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
    const product = data.data?.product;

    // Process gallery media
    const galleryMedia = (product?.media?.edges || [])
      .filter((edge: any) => edge?.node?.image?.url)
      .map((edge: any, index: number) => ({
        mediaId: edge.node.id,
        url: edge.node.image.url,
        position: index,
        altText: edge.node.image.altText,
      }));

    // Process variant assignments
    const variantAssignments = new Map();
    const variants = product?.variants?.edges || [];

    for (const edge of variants) {
      if (variantIds.includes(edge.node.id)) {
        variantAssignments.set(edge.node.id, {
          variantId: edge.node.id,
          displayName: edge.node.displayName,
          heroMediaId: edge.node.image?.id || null,
          heroUrl: edge.node.image?.url || null,
        });
      }
    }

    console.log(`[captureCurrentState] Captured state: ${galleryMedia.length} gallery images, ${variantAssignments.size} variant assignments`);

    return {
      galleryMedia,
      variantAssignments,
    };
  }

  /**
   * Build the target state for rotation
   * Determines what the product should look like after rotation
   */
  static async buildTargetState(
    test: ABTest & { variants?: any[] },
    targetCase: 'BASE' | 'TEST',
    currentState: Awaited<ReturnType<typeof SimpleRotationService.captureCurrentState>>
  ): Promise<{
    targetGallery: ImageData[];
    targetVariantHeros: Map<string, ImageData | null>;
    mediaRegistry: Map<string, {
      permanentUrl?: string;
      url: string;
      usage: Array<'gallery' | 'variant_hero'>;
      position?: number;
      variants?: string[];
      mediaId?: string;
      altText?: string;
    }>;
  }> {
    // Get target images based on case
    const targetGallery = targetCase === 'BASE'
      ? (test.baseImages as unknown as ImageData[])
      : (test.testImages as unknown as ImageData[]);

    // Get target variant heroes
    const targetVariantHeros = new Map<string, ImageData | null>();

    if (test.variants) {
      for (const variant of test.variants) {
        const heroImage = targetCase === 'BASE'
          ? variant.baseHeroImage
          : variant.testHeroImage;

        targetVariantHeros.set(variant.shopifyVariantId, heroImage);
      }
    }

    // Build unified media registry for deduplication
    const mediaRegistry = new Map<string, any>();

    // Add gallery images to registry
    for (const img of targetGallery) {
      const key = SimpleRotationService.normalizeUrl(img.permanentUrl || img.url);
      mediaRegistry.set(key, {
        permanentUrl: img.permanentUrl,
        url: img.url,
        mediaId: img.mediaId,
        usage: ['gallery'],
        position: img.position,
        altText: img.altText,
      });
    }

    // Add variant heroes to registry (deduplicating with gallery)
    for (const [variantId, heroImage] of targetVariantHeros) {
      if (!heroImage) continue;

      const key = SimpleRotationService.normalizeUrl(heroImage.permanentUrl || heroImage.url);

      if (mediaRegistry.has(key)) {
        // Already in gallery - mark for reuse
        const entry = mediaRegistry.get(key);
        entry.usage.push('variant_hero');
        if (!entry.variants) entry.variants = [];
        entry.variants.push(variantId);
      } else {
        // New media needed only for variant
        mediaRegistry.set(key, {
          permanentUrl: heroImage.permanentUrl,
          url: heroImage.url,
          mediaId: heroImage.mediaId,
          usage: ['variant_hero'],
          variants: [variantId],
          altText: heroImage.altText,
        });
      }
    }

    console.log(`[buildTargetState] Target state: ${targetGallery.length} gallery images, ${targetVariantHeros.size} variant heroes, ${mediaRegistry.size} unique media items`);

    return {
      targetGallery,
      targetVariantHeros,
      mediaRegistry,
    };
  }

  /**
   * Normalize URL for comparison (remove query params, lowercase, etc)
   */
  private static normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove query params and fragment
      parsed.search = '';
      parsed.hash = '';
      // Normalize to lowercase
      return parsed.toString().toLowerCase();
    } catch {
      // Fallback for invalid URLs
      return url.toLowerCase().split('?')[0].split('#')[0];
    }
  }

  /**
   * Check if media can be safely deleted (not used elsewhere)
   */
  private static canSafelyDeleteMedia(
    mediaId: string,
    currentState: Awaited<ReturnType<typeof SimpleRotationService.captureCurrentState>>,
    targetState: Awaited<ReturnType<typeof SimpleRotationService.buildTargetState>>
  ): boolean {
    // Check if it's in the target gallery
    const inTargetGallery = targetState.targetGallery.some(img => img.mediaId === mediaId);
    if (inTargetGallery) return false;

    // Check if it's a target variant hero
    for (const heroImage of targetState.targetVariantHeros.values()) {
      if (heroImage?.mediaId === mediaId) return false;
    }

    // Safe to delete if not in any target
    return true;
  }

  /**
   * Upload media to product
   */
  private static async uploadMediaToProduct(
    admin: AdminApiContext,
    productId: string,
    imageUrl: string,
    altText?: string
  ): Promise<string> {
    // Check if it's a private R2 URL that needs to be uploaded to Shopify
    let uploadUrl = imageUrl;
    if (isPrivateR2Url(imageUrl)) {
      console.log(`[uploadMediaToProduct] Converting R2 URL to Shopify: ${imageUrl}`);
      uploadUrl = await uploadR2ImageToShopify(admin, imageUrl, altText);
    }

    const mutation = `
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

    const response = await admin.graphql(mutation, {
      variables: {
        productId,
        media: [{
          mediaContentType: 'IMAGE',
          originalSource: uploadUrl,
          alt: altText,
        }],
      },
    });

    const result = await response.json();

    if (result.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
      const errors = result.data.productCreateMedia.mediaUserErrors;
      throw new Error(`Failed to upload media: ${errors.map((e: any) => e.message).join(', ')}`);
    }

    const newMedia = result.data?.productCreateMedia?.media?.[0];
    if (!newMedia) {
      throw new Error('No media returned from upload');
    }

    return newMedia.id;
  }

  /**
   * Reorder product media
   */
  private static async reorderProductMedia(
    admin: AdminApiContext,
    productId: string,
    orderedMediaIds: string[]
  ): Promise<void> {
    const mutation = `
      mutation reorderProductMedia($productId: ID!, $moves: [MoveInput!]!) {
        productReorderMedia(id: $productId, moves: $moves) {
          job {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Build moves array - each media gets its new position
    const moves = orderedMediaIds.map((mediaId, index) => ({
      id: mediaId,
      newPosition: String(index),
    }));

    const response = await admin.graphql(mutation, {
      variables: {
        productId,
        moves,
      },
    });

    const result = await response.json();

    if (result.data?.productReorderMedia?.userErrors?.length > 0) {
      const errors = result.data.productReorderMedia.userErrors;
      console.warn(`[reorderProductMedia] Warning: ${errors.map((e: any) => e.message).join(', ')}`);
    }
  }

  /**
   * Attach media to variant
   */
  private static async attachMediaToVariant(
    admin: AdminApiContext,
    variantId: string,
    mediaId: string
  ): Promise<void> {
    const mutation = `
      mutation updateVariantMedia($variantId: ID!, $mediaId: ID) {
        productVariantUpdate(input: {
          id: $variantId,
          mediaId: $mediaId
        }) {
          productVariant {
            id
            image {
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

    const response = await admin.graphql(mutation, {
      variables: {
        variantId,
        mediaId,
      },
    });

    const result = await response.json();

    if (result.data?.productVariantUpdate?.userErrors?.length > 0) {
      const errors = result.data.productVariantUpdate.userErrors;
      throw new Error(`Failed to attach media to variant: ${errors.map((e: any) => e.message).join(', ')}`);
    }
  }

  /**
   * Delete product media
   */
  private static async deleteProductMedia(
    admin: AdminApiContext,
    productId: string,
    mediaId: string
  ): Promise<void> {
    const mutation = `
      mutation deleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(mutation, {
      variables: {
        productId,
        mediaIds: [mediaId],
      },
    });

    const result = await response.json();

    if (result.data?.productDeleteMedia?.userErrors?.length > 0) {
      const errors = result.data.productDeleteMedia.userErrors;
      console.warn(`[deleteProductMedia] Warning: ${errors.map((e: any) => e.message).join(', ')}`);
    }
  }
}
