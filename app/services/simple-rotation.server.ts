import { type ABTest } from '@prisma/client';
import db from '../db.server';
import { AuditService } from './audit.server';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';

interface ImageData {
  url: string;
  mediaId?: string;
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
      const galleryImages = targetCase === 'BASE'
        ? (test.baseImages as unknown as ImageData[])
        : (test.testImages as unknown as ImageData[]);

      if (galleryImages && galleryImages.length > 0) {
        await this.updateProductMedia(admin, test.productId, galleryImages);
        imagesUpdated = galleryImages.length;

        // Log gallery update
        await AuditService.logImagesUploaded(
          testId,
          test.shop,
          imagesUpdated,
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

        if (heroImage) {
          await this.updateVariantHero(admin, variant.shopifyVariantId, heroImage, test.productId);
          variantsUpdated++;

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
        }
      }

      // Update test state
      const nextRotation = new Date();
      nextRotation.setHours(nextRotation.getHours() + test.rotationHours);

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
   * Update product gallery images
   */
  private static async updateProductMedia(
    admin: AdminApiContext,
    productId: string,
    images: ImageData[]
  ): Promise<void> {
    // First, get current media to avoid duplicates
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
                  }
                }
              }
            }
          }
        }
      }
    `;

    const currentMediaResponse = await admin.graphql(currentMediaQuery, {
      variables: { productId },
    });

    const currentMedia = await currentMediaResponse.json();
    const existingMediaIds = currentMedia.data?.product?.media?.edges?.map(
      (edge: any) => edge.node.id
    ) || [];

    // Delete existing media
    if (existingMediaIds.length > 0) {
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

      await admin.graphql(deleteQuery, {
        variables: {
          productId,
          mediaIds: existingMediaIds,
        },
      });
    }

    // Create new media from images
    const createMediaOperations = images.map(async (image) => {
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

      return admin.graphql(createQuery, {
        variables: {
          productId,
          media: [{
            originalSource: image.url,
            alt: image.altText || '',
            mediaContentType: 'IMAGE',
          }],
        },
      });
    });

    // Execute all media creation in parallel
    const results = await Promise.all(createMediaOperations);

    // Check for errors
    for (const result of results) {
      const data = await result.json();
      if (data.data?.productCreateMedia?.userErrors?.length > 0) {
        throw new Error(
          `Failed to create media: ${JSON.stringify(data.data.productCreateMedia.userErrors)}`
        );
      }
    }
  }

  /**
   * Update variant hero image
   */
  private static async updateVariantHero(
    admin: AdminApiContext,
    variantId: string,
    heroImage: ImageData,
    productId?: string
  ): Promise<void> {
    // Get product ID - either passed or query from variant
    let productGid = productId;

    if (!productGid) {
      // Query variant to get its product
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

    // Create media on product first
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

    const mediaResult = await admin.graphql(createMediaQuery, {
      variables: {
        productId: productGid,
        media: [{
          originalSource: heroImage.url,
          alt: heroImage.altText || '',
          mediaContentType: 'IMAGE',
        }],
      },
    });

    const mediaData = await mediaResult.json();
    if (mediaData.data?.productCreateMedia?.userErrors?.length > 0) {
      throw new Error(
        `Failed to create variant media: ${JSON.stringify(mediaData.data.productCreateMedia.userErrors)}`
      );
    }

    const newMediaId = mediaData.data?.productCreateMedia?.media?.[0]?.id;
    if (!newMediaId) {
      throw new Error('Failed to get media ID after creation');
    }

    // Attach media to variant using productVariantsBulkUpdate
    const attachMediaQuery = `
      mutation attachMediaToVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(
          productId: $productId,
          variants: $variants
        ) {
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
      }
    `;

    const attachResult = await admin.graphql(attachMediaQuery, {
      variables: {
        productId: productGid,
        variants: [{
          id: variantId,
          mediaId: newMediaId,
        }],
      },
    });

    const attachData = await attachResult.json();
    if (attachData.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
      throw new Error(
        `Failed to attach media to variant: ${JSON.stringify(attachData.data.productVariantsBulkUpdate.userErrors)}`
      );
    }
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
    nextRotation.setHours(nextRotation.getHours() + test.rotationHours);

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
   */
  static async captureBaseImages(
    admin: AdminApiContext,
    productId: string
  ): Promise<ImageData[]> {
    const query = `
      query getProductImages($productId: ID!) {
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

    const response = await admin.graphql(query, {
      variables: { productId },
    });

    const data = await response.json();
    const media = data.data?.product?.media?.edges || [];

    return media.map((edge: any, index: number) => ({
      url: edge.node.image.url,
      mediaId: edge.node.id,
      position: index,
      altText: edge.node.image.altText,
    }));
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