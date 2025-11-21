/**
 * MediaRegistryService manages the mapping between tests and their media.
 * Tracks which mediaIds belong to which test case and provides utilities
 * for managing media associations.
 */

import type { PrismaClient } from "@prisma/client";

export interface MediaMapping {
  testId: string;
  baseMediaIds: string[];
  testMediaIds: string[];
}

export interface MediaRecord {
  mediaId: string;
  testCase: "BASE" | "TEST";
  position: number;
  url: string;
  altText?: string;
  sourceUrl?: string;
}

export class MediaRegistryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Register media for a test
   */
  async registerMedia(
    testId: string,
    testCase: "BASE" | "TEST",
    mediaRecords: MediaRecord[]
  ): Promise<void> {
    // Delete existing media records for this test case
    await this.prisma.testMedia.deleteMany({
      where: {
        testId,
        testCase,
      },
    });

    // Create new media records
    const createData = mediaRecords.map((record, index) => ({
      testId,
      mediaId: record.mediaId,
      testCase,
      position: record.position ?? index,
      url: record.url,
      altText: record.altText,
      sourceUrl: record.sourceUrl,
    }));

    await this.prisma.testMedia.createMany({
      data: createData,
    });

    // Update the test with the new mediaIds
    const mediaIds = mediaRecords.map(r => r.mediaId);

    if (testCase === "BASE") {
      await this.prisma.aBTest.update({
        where: { id: testId },
        data: { baseMediaIds: mediaIds },
      });
    } else {
      await this.prisma.aBTest.update({
        where: { id: testId },
        data: { testMediaIds: mediaIds },
      });
    }
  }

  /**
   * Get media mapping for a test
   */
  async getMediaMapping(testId: string): Promise<MediaMapping> {
    const test = await this.prisma.aBTest.findUnique({
      where: { id: testId },
      select: {
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    return {
      testId,
      baseMediaIds: test.baseMediaIds || [],
      testMediaIds: test.testMediaIds || [],
    };
  }

  /**
   * Get active media IDs for a specific test case
   */
  async getActiveMediaIds(
    testId: string,
    testCase: "BASE" | "TEST"
  ): Promise<string[]> {
    const test = await this.prisma.aBTest.findUnique({
      where: { id: testId },
      select: {
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    return testCase === "BASE"
      ? (test.baseMediaIds || [])
      : (test.testMediaIds || []);
  }

  /**
   * Get detailed media records for a test
   */
  async getMediaRecords(
    testId: string,
    testCase?: "BASE" | "TEST"
  ): Promise<MediaRecord[]> {
    const where: any = { testId };
    if (testCase) {
      where.testCase = testCase;
    }

    const records = await this.prisma.testMedia.findMany({
      where,
      orderBy: { position: "asc" },
    });

    return records.map(r => ({
      mediaId: r.mediaId,
      testCase: r.testCase as "BASE" | "TEST",
      position: r.position,
      url: r.url,
      altText: r.altText || undefined,
      sourceUrl: r.sourceUrl || undefined,
    }));
  }

  /**
   * Update variant hero media IDs
   */
  async updateVariantHeroes(
    testId: string,
    variantId: string,
    baseHeroMediaId: string | null,
    testHeroMediaId: string | null
  ): Promise<void> {
    await this.prisma.aBTestVariant.update({
      where: {
        testId_shopifyVariantId: {
          testId,
          shopifyVariantId: variantId,
        },
      },
      data: {
        baseHeroMediaId,
        testHeroMediaId,
      },
    });
  }

  /**
   * Get variant hero media IDs for rotation
   */
  async getVariantHeroMediaIds(
    testId: string,
    testCase: "BASE" | "TEST"
  ): Promise<Array<{ variantId: string; mediaId: string | null }>> {
    const variants = await this.prisma.aBTestVariant.findMany({
      where: { testId },
      select: {
        shopifyVariantId: true,
        baseHeroMediaId: true,
        testHeroMediaId: true,
      },
    });

    return variants.map(v => ({
      variantId: v.shopifyVariantId,
      mediaId: testCase === "BASE"
        ? v.baseHeroMediaId
        : v.testHeroMediaId,
    }));
  }

  /**
   * Find orphaned media (not referenced by any test)
   */
  async findOrphanedMedia(productId: string): Promise<string[]> {
    // Get all tests for this product
    const tests = await this.prisma.aBTest.findMany({
      where: {
        productId,
        status: { in: ["DRAFT", "ACTIVE", "PAUSED"] },
      },
      select: {
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    // Collect all referenced media IDs
    const referencedMediaIds = new Set<string>();

    for (const test of tests) {
      test.baseMediaIds?.forEach(id => referencedMediaIds.add(id));
      test.testMediaIds?.forEach(id => referencedMediaIds.add(id));
    }

    // Get variant hero images
    const variants = await this.prisma.aBTestVariant.findMany({
      where: {
        test: {
          productId,
          status: { in: ["DRAFT", "ACTIVE", "PAUSED"] },
        },
      },
      select: {
        baseHeroMediaId: true,
        testHeroMediaId: true,
      },
    });

    for (const variant of variants) {
      if (variant.baseHeroMediaId) {
        referencedMediaIds.add(variant.baseHeroMediaId);
      }
      if (variant.testHeroMediaId) {
        referencedMediaIds.add(variant.testHeroMediaId);
      }
    }

    // This would need to be compared against actual gallery media
    // Return the set for the caller to check against gallery
    return Array.from(referencedMediaIds);
  }

  /**
   * Clean up media records for deleted tests
   */
  async cleanupOrphanedRecords(): Promise<number> {
    // Find TestMedia records without corresponding ABTest
    const orphanedRecords = await this.prisma.testMedia.findMany({
      where: {
        test: {
          is: null,
        },
      },
      select: { id: true },
    });

    if (orphanedRecords.length === 0) {
      return 0;
    }

    const result = await this.prisma.testMedia.deleteMany({
      where: {
        id: {
          in: orphanedRecords.map(r => r.id),
        },
      },
    });

    return result.count;
  }

  /**
   * Mark media as migrated from R2
   */
  async markMediaAsMigrated(
    testId: string,
    mediaId: string,
    sourceUrl: string
  ): Promise<void> {
    await this.prisma.testMedia.update({
      where: {
        testId_mediaId: {
          testId,
          mediaId,
        },
      },
      data: {
        sourceUrl,
        migratedAt: new Date(),
      },
    });
  }

  /**
   * Get migration status for a test
   */
  async getMigrationStatus(testId: string): Promise<{
    hasMigrated: boolean;
    baseMediaMigrated: boolean;
    testMediaMigrated: boolean;
    totalMedia: number;
    migratedMedia: number;
  }> {
    const test = await this.prisma.aBTest.findUnique({
      where: { id: testId },
      include: {
        mediaRecords: true,
      },
    });

    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    const baseMediaMigrated = test.baseMediaIds && test.baseMediaIds.length > 0;
    const testMediaMigrated = test.testMediaIds && test.testMediaIds.length > 0;
    const hasMigrated = baseMediaMigrated && testMediaMigrated;

    const totalMedia = test.mediaRecords.length;
    const migratedMedia = test.mediaRecords.filter(r => r.migratedAt !== null).length;

    return {
      hasMigrated,
      baseMediaMigrated,
      testMediaMigrated,
      totalMedia,
      migratedMedia,
    };
  }

  /**
   * Bulk update media IDs for a test (used during migration)
   */
  async bulkUpdateMediaIds(
    testId: string,
    baseMediaIds: string[],
    testMediaIds: string[]
  ): Promise<void> {
    await this.prisma.aBTest.update({
      where: { id: testId },
      data: {
        baseMediaIds,
        testMediaIds,
      },
    });
  }

  /**
   * Get all tests that need migration
   */
  async getTestsNeedingMigration(): Promise<string[]> {
    const tests = await this.prisma.aBTest.findMany({
      where: {
        OR: [
          { baseMediaIds: { equals: [] } },
          { testMediaIds: { equals: [] } },
          { baseMediaIds: null },
          { testMediaIds: null },
        ],
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      select: { id: true },
    });

    return tests.map(t => t.id);
  }

  /**
   * Validate that all media IDs exist for a test
   */
  async validateMediaIds(testId: string): Promise<{
    valid: boolean;
    missingBase: string[];
    missingTest: string[];
  }> {
    const mapping = await this.getMediaMapping(testId);

    // This would need to be validated against actual Shopify gallery
    // For now, just check that arrays are not empty
    const valid = mapping.baseMediaIds.length > 0 && mapping.testMediaIds.length > 0;

    return {
      valid,
      missingBase: [], // Would need gallery check
      missingTest: [], // Would need gallery check
    };
  }
}