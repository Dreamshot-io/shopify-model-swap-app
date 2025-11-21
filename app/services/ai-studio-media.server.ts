/**
 * AIStudioMediaService manages all AI Studio image operations.
 * Replaces the metafield-based storage with proper database tracking.
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db, { lookupShopId } from "../db.server";
import { MediaGalleryService } from "./media-gallery.server";

// Use the Prisma generated type directly
import type { AIStudioImage as PrismaAIStudioImage, PrismaClient } from "@prisma/client";

export type ImageState = "LIBRARY" | "PUBLISHED";
export type ImageSource = "AI_GENERATED" | "MANUAL_UPLOAD" | "GALLERY_IMPORT";

export interface AIStudioImageInput {
  shop: string;
  shopId?: string;
  productId: string;
  url: string;
  mediaId?: string; // Shopify media GID from upload
  source: ImageSource;
  prompt?: string;
  sourceImageUrl?: string;
  aiProvider?: string;
  variantIds?: string[];
}
export type AIStudioImage = PrismaAIStudioImage;

export class AIStudioMediaService {
  private mediaGallery: MediaGalleryService;
  private prisma: PrismaClient;

  constructor(
    private admin: AdminApiContext,
    prisma?: PrismaClient | null
  ) {
    this.prisma = prisma ?? db;

    if (!this.prisma) {
      throw new Error("Prisma client not provided to AIStudioMediaService");
    }

    this.mediaGallery = new MediaGalleryService(admin);
  }

  private async resolveShopId(shop: string, shopId?: string): Promise<string | null> {
    if (shopId) {
      return shopId;
    }
    return await lookupShopId(shop);
  }

  /**
   * Save an image to the library (not published to gallery)
   */
  async saveToLibrary(input: AIStudioImageInput): Promise<AIStudioImage> {
    const shopId = await this.resolveShopId(input.shop, input.shopId);
    if (!shopId) {
      throw new Error(`Unable to resolve shopId for shop: ${input.shop}`);
    }

    // Check if image already exists (by URL)
    const existing = await this.prisma.aIStudioImage.findFirst({
      where: {
        shopId,
        productId: input.productId,
        url: input.url,
      },
    });

    if (existing) {
      console.log(`[AIStudioMedia] Image already exists in library: ${existing.id}`);
      return existing;
    }

    // Create new library entry
    const image = await this.prisma.aIStudioImage.create({
      data: {
        shop: input.shop,
        shopId,
        productId: input.productId,
        url: input.url,
        mediaId: input.mediaId || null, // Shopify media GID if uploaded
        state: "LIBRARY" as ImageState, // Always starts in library
        source: input.source as ImageSource,
        prompt: input.prompt || null,
        sourceImageUrl: input.sourceImageUrl || null,
        aiProvider: input.aiProvider || null,
        variantIds: input.variantIds || [],
      },
    });

    console.log(`[AIStudioMedia] Saved image to library: ${image.id}`);
    return image;
  }

  /**
   * Publish a library image to the Shopify product gallery
   */
  async publishToGallery(imageId: string, shopId?: string): Promise<AIStudioImage> {
    const image = await this.prisma.aIStudioImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new Error(`Image ${imageId} not found`);
    }

    // Verify shopId matches if provided
    if (shopId && image.shopId !== shopId) {
      throw new Error(`Image ${imageId} does not belong to shop ${shopId}`);
    }

    if (image.state === "PUBLISHED" && image.mediaId) {
      const validation = await this.mediaGallery.validateMediaPresence(
        image.productId,
        [image.mediaId]
      );

      if (validation.missing.length === 0) {
      console.log(`[AIStudioMedia] Image already published: ${image.mediaId}`);
      return image;
      }
    }

    const [uploadResult] = await this.mediaGallery.ensureMediaInGallery(
      [{ url: image.url, altText: image.prompt || undefined }],
      image.productId
    );

    if (!uploadResult.success) {
      throw new Error(`Failed to publish image: ${uploadResult.error}`);
    }

    const updated = await this.prisma.aIStudioImage.update({
      where: { id: imageId },
      data: {
        mediaId: uploadResult.mediaId,
        state: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    console.log(`[AIStudioMedia] Published image to gallery: ${uploadResult.mediaId}`);
    return updated;
  }

  /**
   * Unpublish an image from gallery (move back to library only)
   */
  async unpublishFromGallery(imageId: string, shopId?: string): Promise<AIStudioImage> {
    const image = await this.prisma.aIStudioImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new Error(`Image ${imageId} not found`);
    }

    // Verify shopId matches if provided
    if (shopId && image.shopId !== shopId) {
      throw new Error(`Image ${imageId} does not belong to shop ${shopId}`);
    }

    if (image.state === "LIBRARY") {
      console.log(`[AIStudioMedia] Image already in library: ${imageId}`);
      return image;
    }

    const updated = await this.prisma.aIStudioImage.update({
      where: { id: imageId },
      data: {
        state: "LIBRARY",
        publishedAt: null,
      },
    });

    console.log(`[AIStudioMedia] Unpublished image from gallery (media retained): ${imageId}`);
    return updated;
  }

  /**
   * Get all library images for a product
   */
  async getLibraryImages(
    shop: string,
    productId: string,
    variantId?: string,
    shopId?: string
  ): Promise<AIStudioImage[]> {
    const resolvedShopId = shopId || await this.resolveShopId(shop);
    if (!resolvedShopId) {
      throw new Error(`Unable to resolve shopId for shop: ${shop}`);
    }

    const where: any = {
      shopId: resolvedShopId,
      productId,
      state: "LIBRARY",
    };

    // Filter by variant if specified
    if (variantId) {
      where.OR = [
        { variantIds: { has: variantId } },
        { variantIds: { isEmpty: true } }, // Include images without variant restrictions
      ];
    }

    const images = await this.prisma.aIStudioImage.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return images;
  }

  /**
   * Get all published images for a product
   */
  async getPublishedImages(
    shop: string,
    productId: string,
    shopId?: string
  ): Promise<AIStudioImage[]> {
    const resolvedShopId = shopId || await this.resolveShopId(shop);
    if (!resolvedShopId) {
      throw new Error(`Unable to resolve shopId for shop: ${shop}`);
    }

    const images = await this.prisma.aIStudioImage.findMany({
      where: {
        shopId: resolvedShopId,
        productId,
        state: "PUBLISHED",
      },
      orderBy: { publishedAt: "desc" },
    });

    return images;
  }

  /**
   * Get all images (both library and published) for a product
   */
  async getAllImages(
    shop: string,
    productId: string,
    variantId?: string,
    shopId?: string
  ): Promise<AIStudioImage[]> {
    const resolvedShopId = shopId || await this.resolveShopId(shop);
    if (!resolvedShopId) {
      throw new Error(`Unable to resolve shopId for shop: ${shop}`);
    }

    const where: any = {
      shopId: resolvedShopId,
      productId,
    };

    if (variantId) {
      where.OR = [
        { variantIds: { has: variantId } },
        { variantIds: { isEmpty: true } },
      ];
    }

    const images = await this.prisma.aIStudioImage.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return images;
  }

  /**
   * Delete an image from both library and gallery
   */
  async deleteImage(imageId: string, shopId?: string): Promise<void> {
    const image = await this.prisma.aIStudioImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new Error(`Image ${imageId} not found`);
    }

    // Verify shopId matches if provided
    if (shopId && image.shopId !== shopId) {
      throw new Error(`Image ${imageId} does not belong to shop ${shopId}`);
    }

    // If published, remove from gallery first
    if (image.state === "PUBLISHED" && image.mediaId) {
      await this.unpublishFromGallery(imageId, shopId);
    }

    // Delete from database
    await this.prisma.aIStudioImage.delete({
      where: { id: imageId },
    });

    console.log(`[AIStudioMedia] Deleted image: ${imageId}`);
  }

  /**
   * Import existing gallery images into the library system
   */
  async importGalleryImage(
    shop: string,
    productId: string,
    mediaId: string,
    url: string,
    shopId?: string
  ): Promise<AIStudioImage> {
    const resolvedShopId = shopId || await this.resolveShopId(shop);
    if (!resolvedShopId) {
      throw new Error(`Unable to resolve shopId for shop: ${shop}`);
    }

    // Check if already imported
    const existing = await this.prisma.aIStudioImage.findFirst({
      where: {
        shopId: resolvedShopId,
        productId,
        mediaId,
      },
    });

    if (existing) {
      return existing;
    }

    // Create as published since it's already in gallery
    const image = await this.prisma.aIStudioImage.create({
      data: {
        shop,
        shopId: resolvedShopId,
        productId,
        mediaId,
        url,
        state: "PUBLISHED" as ImageState,
        source: "GALLERY_IMPORT" as ImageSource,
        publishedAt: new Date(),
      },
    });

    console.log(`[AIStudioMedia] Imported gallery image: ${image.id}`);
    return image;
  }

  /**
   * Migrate library data from metafield to database
   */
  async migrateFromMetafield(
    shop: string,
    productId: string,
    metafieldValue: string,
    shopId?: string
  ): Promise<number> {
    try {
      const resolvedShopId = shopId || await this.resolveShopId(shop);
      if (!resolvedShopId) {
        throw new Error(`Unable to resolve shopId for shop: ${shop}`);
      }

      const libraryItems = JSON.parse(metafieldValue);
      let migrated = 0;

      for (const item of libraryItems) {
        // Handle both string and object formats
        const imageData = typeof item === "string"
          ? { imageUrl: item }
          : item;

        // Skip if already migrated
        const existing = await this.prisma.aIStudioImage.findFirst({
          where: {
            shopId: resolvedShopId,
            productId,
            url: imageData.imageUrl,
          },
        });

        if (existing) {
          continue;
        }

        // Determine source based on URL patterns
        let source: ImageSource = "MANUAL_UPLOAD";
        if (imageData.sourceUrl) {
          source = "AI_GENERATED";
        } else if (imageData.imageUrl.includes("cdn.shopify.com")) {
          source = "GALLERY_IMPORT";
        }

        // Create database record
        await this.prisma.aIStudioImage.create({
          data: {
            shop,
            shopId: resolvedShopId,
            productId,
            url: imageData.imageUrl,
            state: "LIBRARY" as ImageState, // Metafield items are library items
            source: source as ImageSource,
            sourceImageUrl: imageData.sourceUrl || null,
            variantIds: imageData.variantIds || [],
          },
        });

        migrated++;
      }

      console.log(`[AIStudioMedia] Migrated ${migrated} images from metafield`);
      return migrated;

    } catch (error) {
      console.error("Failed to migrate metafield:", error);
      return 0;
    }
  }

  /**
   * Check if a URL already exists in the library
   */
  async imageExists(
    shop: string,
    productId: string,
    url: string,
    shopId?: string
  ): Promise<boolean> {
    const resolvedShopId = shopId || await this.resolveShopId(shop);
    if (!resolvedShopId) {
      throw new Error(`Unable to resolve shopId for shop: ${shop}`);
    }

    const count = await this.prisma.aIStudioImage.count({
      where: {
        shopId: resolvedShopId,
        productId,
        url,
      },
    });

    return count > 0;
  }

  /**
   * Update variant associations for an image
   */
  async updateVariantAssociations(
    imageId: string,
    variantIds: string[]
  ): Promise<AIStudioImage> {
    const updated = await this.prisma.aIStudioImage.update({
      where: { id: imageId },
      data: { variantIds },
    });

    return updated;
  }
}
