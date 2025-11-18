import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { PrismaClient } from "@prisma/client";
import {
  SimpleRotationService,
  type RotationResult,
  type TestCase,
} from "./simple-rotation.server";

export class CompatibilityRotationService {
  constructor(
    private admin: AdminApiContext,
    private prisma: PrismaClient,
  ) {}

  async rotateTest(
    testId: string,
    targetCase: TestCase,
	triggeredBy: 'CRON' | 'MANUAL' | 'SYSTEM' = 'SYSTEM',
	): Promise<RotationResult> {
		return SimpleRotationService.rotateTest(testId, triggeredBy, undefined, this.admin, targetCase);
	}

  async canUseV2(testId: string): Promise<boolean> {
    const test = await this.prisma.aBTest.findUnique({
      where: { id: testId },
      select: {
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    if (!test) {
      return false;
    }

    return (
      Array.isArray(test.baseMediaIds) &&
      test.baseMediaIds.length > 0 &&
      Array.isArray(test.testMediaIds) &&
      test.testMediaIds.length > 0
    );
  }

  async getRotationCapabilities(testId: string): Promise<{
    canRotate: boolean;
    useV2: boolean;
    needsMigration: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    const test = await this.prisma.aBTest.findUnique({
      where: { id: testId },
      select: {
        status: true,
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    if (!test) {
      errors.push("Test not found");
      return {
        canRotate: false,
        useV2: false,
        needsMigration: false,
        errors,
      };
    }

    const hasBaseMedia =
      Array.isArray(test.baseMediaIds) && test.baseMediaIds.length > 0;
    const hasTestMedia =
      Array.isArray(test.testMediaIds) && test.testMediaIds.length > 0;

    if (test.status !== "ACTIVE" && test.status !== "PAUSED") {
      errors.push(`Test status is ${test.status}, must be ACTIVE or PAUSED`);
    }

    if (!hasBaseMedia || !hasTestMedia) {
      errors.push("Test is missing Shopify media IDs for one of the cases");
    }

    return {
      canRotate: errors.length === 0,
      useV2: hasBaseMedia && hasTestMedia,
      needsMigration: false,
      errors,
    };
  }

  async batchRotate(
    testIds: string[],
    targetCase: TestCase,
  ): Promise<Map<string, RotationResult>> {
    const results = new Map<string, RotationResult>();

    for (const testId of testIds) {
      try {
        const result = await this.rotateTest(testId, targetCase);
        results.set(testId, result);
      } catch (error) {
        const test = await this.prisma.aBTest.findUnique({
          where: { id: testId },
          select: { currentCase: true },
        });

        results.set(testId, {
          success: false,
          duration: 0,
          fromCase: (test?.currentCase as TestCase) ?? "BASE",
          toCase: targetCase,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  }

  async getSystemStats(): Promise<{
    totalTests: number;
    v2Ready: number;
    v1Only: number;
    needsMigration: number;
    migrationProgress: number;
  }> {
    const tests = await this.prisma.aBTest.findMany({
      where: {
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      select: {
        baseMediaIds: true,
        testMediaIds: true,
      },
    });

    const totalTests = tests.length;
    const v2Ready = tests.filter(
      (test) =>
        Array.isArray(test.baseMediaIds) &&
        test.baseMediaIds.length > 0 &&
        Array.isArray(test.testMediaIds) &&
        test.testMediaIds.length > 0,
    ).length;

    return {
      totalTests,
      v2Ready,
      v1Only: 0,
      needsMigration: 0,
      migrationProgress: totalTests > 0 ? (v2Ready / totalTests) * 100 : 0,
    };
  }

  async getRotationMetrics(shop: string): Promise<{
    v1Metrics: { totalRotations: number; averageDuration: number };
    v2Metrics: { totalRotations: number; averageDuration: number };
    overallMetrics: {
      totalRotations: number;
      v1Rotations: number;
      v2Rotations: number;
      averageSpeedImprovement: number;
    };
  }> {
    const rotationEvents = await this.prisma.rotationEvent.findMany({
      where: {
        test: { shop },
      },
      select: {
        success: true,
        duration: true,
      },
    });

    const totalRotations = rotationEvents.length;
    const successfulRotations = rotationEvents.filter((e) => e.success);
    const averageDuration =
      successfulRotations.length > 0
        ? successfulRotations.reduce((sum, event) => sum + event.duration, 0) /
          successfulRotations.length
        : 0;

    return {
      v1Metrics: { totalRotations: 0, averageDuration: 0 },
      v2Metrics: {
        totalRotations,
        averageDuration,
      },
      overallMetrics: {
        totalRotations,
        v1Rotations: 0,
        v2Rotations: totalRotations,
        averageSpeedImprovement: 0,
      },
    };
  }
}
