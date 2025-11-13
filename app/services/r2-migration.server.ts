/**
 * R2MigrationService handles the migration of images from R2 storage to Shopify Media Gallery.
 * This is a temporary service that will be deprecated once all images are migrated.
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { PrismaClient } from "@prisma/client";
import { MediaGalleryService, type UploadMediaInput } from "./media-gallery.server";
import { MediaRegistryService, type MediaRecord } from "./media-registry.server";
import { uploadR2ImageToShopify } from "./shopify-image-upload.server";
import { createAuditLog } from "../models/audit.server";

export interface MigrationStatus {
  testId: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  baseImagesMigrated: boolean;
  testImagesMigrated: boolean;
  totalImages: number;
  migratedImages: number;
  error?: string;
}

export interface MigrationReport {
  totalTests: number;
  migratedTests: number;
  failedTests: number;
  pendingTests: number;
  errors: Array<{ testId: string; error: string }>;
}

interface ImageData {
  url: string;
  permanentUrl?: string;
  mediaId?: string;
  position?: number;
  altText?: string;
}

export class R2MigrationService {
  private mediaGallery: MediaGalleryService;
  private mediaRegistry: MediaRegistryService;
  private migrationStatus: Map<string, MigrationStatus> = new Map();
  private readonly DEFAULT_MIGRATION_TIMEOUT = 30000; // 30 seconds default timeout

  constructor(
    private admin: AdminApiContext,
    private prisma: PrismaClient
  ) {
    this.mediaGallery = new MediaGalleryService(admin);
    this.mediaRegistry = new MediaRegistryService(prisma);
  }

  /**
   * Migrate all active tests to gallery-based system
   */
  async migrateAllTests(): Promise<MigrationReport> {
    const tests = await this.prisma.aBTest.findMany({
      where: {
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      select: {
        id: true,
        shop: true,
        productId: true,
        baseImages: true,
        testImages: true,
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    const report: MigrationReport = {
      totalTests: tests.length,
      migratedTests: 0,
      failedTests: 0,
      pendingTests: 0,
      errors: [],
    };

    for (const test of tests) {
      // Skip if already migrated (check if ANY media IDs exist OR TestMedia records)
      const testMediaCount = await this.prisma.testMedia.count({
        where: { testId: test.id }
      });

      if ((test.baseMediaIds.length > 0 || test.testMediaIds.length > 0) || testMediaCount > 0) {
        report.migratedTests++;
        continue;
      }

      const result = await this.migrateTest(test.id);

      if (result.status === "completed") {
        report.migratedTests++;
      } else if (result.status === "failed") {
        report.failedTests++;
        report.errors.push({
          testId: test.id,
          error: result.error || "Unknown error",
        });
      } else {
        report.pendingTests++;
      }
    }

    return report;
  }

  /**
   * Migrate a single test with timeout protection
   * Used during rotation to prevent hanging
   */
  async migrateTestWithTimeout(
    testId: string,
    timeoutMs: number = this.DEFAULT_MIGRATION_TIMEOUT
  ): Promise<MigrationStatus> {
    return Promise.race([
      this.migrateTest(testId),
      new Promise<MigrationStatus>((_, reject) => {
        setTimeout(() => {
          this.updateMigrationStatus(testId, "failed", {
            error: `Migration timed out after ${timeoutMs}ms`
          });
          reject(new Error(`Migration timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  }

  /**
   * Migrate a single test from R2 to Shopify gallery
   */
  async migrateTest(testId: string): Promise<MigrationStatus> {
    try {
      // Update migration status
      this.updateMigrationStatus(testId, "in_progress");

      const test = await this.prisma.aBTest.findUnique({
        where: { id: testId },
        include: { variants: true },
      });

      if (!test) {
        throw new Error(`Test ${testId} not found`);
      }

      // Parse legacy JSON data
      const baseImages = test.baseImages as unknown as ImageData[];
      const testImages = test.testImages as unknown as ImageData[];

      // Check if already migrated (TestMedia records are the source of truth)
      const testMediaCount = await this.prisma.testMedia.count({
        where: { testId }
      });

      const hasMediaIds = test.baseMediaIds.length > 0 || test.testMediaIds.length > 0;

      if (hasMediaIds || testMediaCount > 0) {
        console.log(`[R2Migration] Test ${testId} already migrated`, {
          baseMediaIds: test.baseMediaIds.length,
          testMediaIds: test.testMediaIds.length,
          testMediaRecords: testMediaCount,
        });

        this.updateMigrationStatus(testId, "completed", {
          baseImagesMigrated: test.baseMediaIds.length > 0,
          testImagesMigrated: true,
          totalImages: baseImages.length + testImages.length,
          migratedImages: baseImages.length + testImages.length,
        });

        return this.migrationStatus.get(testId)!;
      }

      // Update test status to MIGRATING
      await this.prisma.aBTest.update({
        where: { id: testId },
        data: { status: "MIGRATING" },
      });

      // Migrate base images
      let baseMediaIds: string[] = [];
      if (test.baseMediaIds.length === 0) {
        baseMediaIds = await this.migrateImageSet(
          baseImages,
          test.productId,
          testId,
          "BASE"
        );
      } else {
        baseMediaIds = test.baseMediaIds;
      }

      // Migrate test images
      let testMediaIds: string[] = [];
      if (test.testMediaIds.length === 0) {
        testMediaIds = await this.migrateImageSet(
          testImages,
          test.productId,
          testId,
          "TEST"
        );
      } else {
        testMediaIds = test.testMediaIds;
      }

      // Migrate variant hero images
      await this.migrateVariantHeroes(test.variants, test.productId);

      // Update test with new mediaIds
      await this.prisma.aBTest.update({
        where: { id: testId },
        data: {
          baseMediaIds,
          testMediaIds,
          status: test.status === "MIGRATING" ? "ACTIVE" : test.status,
        },
      });

      // Create audit log
      await createAuditLog(this.prisma, {
        testId,
        entityType: "MIGRATION",
        eventType: "R2_TO_GALLERY_MIGRATION",
        shop: test.shop,
        description: `Migrated ${baseMediaIds.length + testMediaIds.length} images from R2 to Shopify gallery`,
        metadata: {
          baseImagesCount: baseMediaIds.length,
          testImagesCount: testMediaIds.length,
        },
      });

      // Update migration status
      this.updateMigrationStatus(testId, "completed", {
        baseImagesMigrated: true,
        testImagesMigrated: true,
        totalImages: baseImages.length + testImages.length,
        migratedImages: baseMediaIds.length + testMediaIds.length,
      });

      return this.migrationStatus.get(testId)!;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Revert test status if it was set to MIGRATING
      const test = await this.prisma.aBTest.findUnique({
        where: { id: testId },
      });

      if (test && test.status === "MIGRATING") {
        await this.prisma.aBTest.update({
          where: { id: testId },
          data: { status: "ACTIVE" },
        });
      }

      this.updateMigrationStatus(testId, "failed", { error: errorMessage });

      await createAuditLog(this.prisma, {
        testId,
        entityType: "MIGRATION",
        eventType: "R2_TO_GALLERY_MIGRATION_FAILED",
        shop: test?.shop || "",
        description: `Migration failed: ${errorMessage}`,
        metadata: { error: errorMessage },
      });

      return this.migrationStatus.get(testId)!;
    }
  }

  /**
   * Migrate a set of images from R2 to Shopify
   */
  private async migrateImageSet(
    images: ImageData[],
    productId: string,
    testId: string,
    testCase: "BASE" | "TEST"
  ): Promise<string[]> {
    const mediaIds: string[] = [];
    const mediaRecords: MediaRecord[] = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];

      // Check if already in gallery using mediaId
      if (image.mediaId) {
        // Validate it still exists
        const exists = await this.mediaGallery.validateMediaAvailability(
          productId,
          [image.mediaId]
        );

        if (exists) {
          mediaIds.push(image.mediaId);
          mediaRecords.push({
            mediaId: image.mediaId,
            testCase,
            position: i,
            url: image.url,
            altText: image.altText,
            sourceUrl: image.permanentUrl,
          });
          continue;
        }
      }

      // Need to upload from R2 or original URL
      let uploadUrl = image.url;
      let sourceUrl = image.permanentUrl;

      // If we have an R2 URL, transfer it to Shopify
      if (image.permanentUrl && image.permanentUrl.includes("r2.cloudflarestorage.com")) {
        try {
          const shopifyUrl = await uploadR2ImageToShopify(
            this.admin,
            image.permanentUrl,
            productId
          );
          uploadUrl = shopifyUrl;
        } catch (error) {
          console.error(`Failed to transfer R2 image: ${error}`);
          // Fall back to original URL
        }
      }

      // Upload to gallery
      const uploadResults = await this.mediaGallery.uploadToGallery(
        [{ url: uploadUrl, altText: image.altText }],
        productId
      );

      if (uploadResults[0]?.success) {
        const mediaId = uploadResults[0].mediaId;
        mediaIds.push(mediaId);
        mediaRecords.push({
          mediaId,
          testCase,
          position: i,
          url: uploadResults[0].url,
          altText: image.altText,
          sourceUrl,
        });
      } else {
        console.error(`Failed to upload image ${i} for test ${testId}`);
      }
    }

    // Register media in database
    if (mediaRecords.length > 0) {
      await this.mediaRegistry.registerMedia(testId, testCase, mediaRecords);
    }

    return mediaIds;
  }

  /**
   * Migrate variant hero images
   */
  private async migrateVariantHeroes(
    variants: any[],
    productId: string
  ): Promise<void> {
    for (const variant of variants) {
      let baseHeroMediaId: string | null = null;
      let testHeroMediaId: string | null = null;

      // Parse legacy JSON data
      const baseHero = variant.baseHeroImage as unknown as ImageData | null;
      const testHero = variant.testHeroImage as unknown as ImageData;

      // Migrate base hero if exists
      if (baseHero) {
        const result = await this.migrateSingleImage(baseHero, productId);
        if (result) {
          baseHeroMediaId = result;
        }
      }

      // Migrate test hero
      if (testHero) {
        const result = await this.migrateSingleImage(testHero, productId);
        if (result) {
          testHeroMediaId = result;
        }
      }

      // Update variant with new mediaIds
      if (baseHeroMediaId || testHeroMediaId) {
        await this.mediaRegistry.updateVariantHeroes(
          variant.testId,
          variant.shopifyVariantId,
          baseHeroMediaId,
          testHeroMediaId
        );
      }
    }
  }

  /**
   * Migrate a single image
   */
  private async migrateSingleImage(
    image: ImageData,
    productId: string
  ): Promise<string | null> {
    // Check if already has mediaId
    if (image.mediaId) {
      const exists = await this.mediaGallery.validateMediaAvailability(
        productId,
        [image.mediaId]
      );
      if (exists) {
        return image.mediaId;
      }
    }

    // Upload from R2 or original URL
    let uploadUrl = image.url;

    if (image.permanentUrl && image.permanentUrl.includes("r2.cloudflarestorage.com")) {
      try {
        uploadUrl = await uploadR2ImageToShopify(
          this.admin,
          image.permanentUrl,
          productId
        );
      } catch (error) {
        console.error(`Failed to transfer R2 image: ${error}`);
      }
    }

    const results = await this.mediaGallery.uploadToGallery(
      [{ url: uploadUrl, altText: image.altText }],
      productId
    );

    return results[0]?.success ? results[0].mediaId : null;
  }

  /**
   * Get migration status for all tests
   */
  async getMigrationReport(): Promise<MigrationReport> {
    const tests = await this.prisma.aBTest.findMany({
      where: {
        status: { in: ["ACTIVE", "PAUSED", "MIGRATING"] },
      },
      select: {
        id: true,
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    const report: MigrationReport = {
      totalTests: tests.length,
      migratedTests: 0,
      failedTests: 0,
      pendingTests: 0,
      errors: [],
    };

    for (const test of tests) {
      if (test.baseMediaIds.length > 0 && test.testMediaIds.length > 0) {
        report.migratedTests++;
      } else {
        report.pendingTests++;
      }
    }

    // Add any failed tests from current session
    for (const [testId, status] of this.migrationStatus.entries()) {
      if (status.status === "failed") {
        report.failedTests++;
        report.errors.push({
          testId,
          error: status.error || "Unknown error",
        });
      }
    }

    return report;
  }

  /**
   * Retry failed migrations
   */
  async retryFailedMigrations(): Promise<MigrationReport> {
    const failedTests: string[] = [];

    for (const [testId, status] of this.migrationStatus.entries()) {
      if (status.status === "failed") {
        failedTests.push(testId);
      }
    }

    const report: MigrationReport = {
      totalTests: failedTests.length,
      migratedTests: 0,
      failedTests: 0,
      pendingTests: 0,
      errors: [],
    };

    for (const testId of failedTests) {
      const result = await this.migrateTest(testId);

      if (result.status === "completed") {
        report.migratedTests++;
      } else if (result.status === "failed") {
        report.failedTests++;
        report.errors.push({
          testId,
          error: result.error || "Unknown error",
        });
      }
    }

    return report;
  }

  /**
   * Update migration status
   */
  private updateMigrationStatus(
    testId: string,
    status: MigrationStatus["status"],
    updates?: Partial<MigrationStatus>
  ): void {
    const current = this.migrationStatus.get(testId) || {
      testId,
      status: "pending",
      baseImagesMigrated: false,
      testImagesMigrated: false,
      totalImages: 0,
      migratedImages: 0,
    };

    this.migrationStatus.set(testId, {
      ...current,
      status,
      ...updates,
    });
  }

  /**
   * Clear migration status cache
   */
  clearMigrationCache(): void {
    this.migrationStatus.clear();
  }
}