import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import db from "../db.server";
import { AuditService } from "./audit.server";
import { MediaGalleryService } from "./media-gallery.server";

export type TestCase = "BASE" | "TEST";

export interface RotationResult {
	success: boolean;
	duration: number;
  fromCase: TestCase;
  toCase: TestCase;
  error?: string;
}

export interface ScheduledRotation {
  id: string;
  shop: string;
  productId: string;
  currentCase: TestCase;
  rotationHours: number;
  nextRotation: Date | null;
}

type RotationTrigger = "CRON" | "MANUAL" | "SYSTEM";

export class SimpleRotationService {
	static async rotateTest(
		testId: string,
    triggeredBy: RotationTrigger = "SYSTEM",
		userId?: string,
		admin?: AdminApiContext,
    explicitTargetCase?: TestCase,
	): Promise<RotationResult> {
    const adminContext = this.requireAdmin(admin);

		const test = await db.aBTest.findUnique({
			where: { id: testId },
      include: {
        variants: true,
      },
		});

		if (!test) {
			throw new Error(`Test ${testId} not found`);
		}

    if (test.status !== "ACTIVE") {
			throw new Error(`Test ${testId} is not active (status: ${test.status})`);
		}

    const fromCase = this.coerceCase(test.currentCase);
    const targetCase =
      explicitTargetCase ?? (fromCase === "BASE" ? "TEST" : "BASE");

    const baseMediaIdsArray = Array.isArray(test.baseMediaIds)
      ? [...test.baseMediaIds]
      : [];
    const testMediaIdsArray = Array.isArray(test.testMediaIds)
      ? [...test.testMediaIds]
      : [];

    // Use only the target case media IDs - don't fill with other case images
    const targetMediaIds =
      targetCase === "BASE" ? baseMediaIdsArray : testMediaIdsArray;

    if (!targetMediaIds || targetMediaIds.length === 0) {
      throw new Error(
        `No ${targetCase.toLowerCase()} media IDs stored for test ${testId}`,
      );
    }

    console.log(`[SimpleRotation] Rotation: ${fromCase} → ${targetCase}`, {
      baseMediaCount: baseMediaIdsArray.length,
      testMediaCount: testMediaIdsArray.length,
      targetMediaCount: targetMediaIds.length,
      targetMediaIds,
    });

    const startTime = Date.now();

    await AuditService.logRotationStarted(
      testId,
      test.shop,
      fromCase,
      targetCase,
      triggeredBy,
      userId,
    );

    try {
      const gallery = new MediaGalleryService(adminContext);

      // Validate media presence (non-fatal - updateProductMediaAssignment will handle missing media)
      const validation = await gallery.validateMediaPresence(
					test.productId,
        targetMediaIds,
      );

      if (validation.missing.length > 0) {
        console.warn(`[SimpleRotation] ⚠️  Some target media not in gallery (will be added):`, validation.missing);
        // Don't throw - updateProductMediaAssignment will add missing media
      }

      await gallery.updateProductMediaAssignment(
        test.productId,
        targetMediaIds,
      );

      const variantUpdates = test.variants.map((variant) => ({
        variantId: variant.shopifyVariantId,
        mediaId:
          targetCase === "BASE"
            ? variant.baseHeroMediaId ?? null
            : variant.testHeroMediaId ?? null,
      }));

      const shouldUpdateVariants = variantUpdates.some(
        (update) => update.mediaId !== undefined,
      );

      if (shouldUpdateVariants) {
        await gallery.updateVariantHeroes(test.productId, variantUpdates);
      }

      const nextRotation =
        test.rotationHours > 0
          ? new Date(Date.now() + test.rotationHours * 60 * 60 * 1000)
          : null;

				await db.aBTest.update({
					where: { id: testId },
					data: {
						currentCase: targetCase,
						lastRotation: new Date(),
          nextRotation,
					},
				});

			const duration = Date.now() - startTime;

			await AuditService.createRotationEvent(
				testId,
        fromCase,
				targetCase,
				triggeredBy,
				true,
				duration,
				userId,
				undefined,
        {
          mediaIdsAssigned: targetMediaIds,
          variantUpdates,
        },
      );

      await AuditService.logRotationCompleted(
        testId,
        test.shop,
        fromCase,
        targetCase,
        duration,
        {
          mediaIdsAssigned: targetMediaIds.length,
          variantUpdates: variantUpdates.length,
        },
			);

			return {
				success: true,
				duration,
        fromCase,
        toCase: targetCase,
			};
		} catch (error) {
			const duration = Date.now() - startTime;
      const message =
        error instanceof Error ? error.message : "Unknown rotation error";

      await AuditService.logRotationFailed(
        testId,
        test.shop,
        fromCase,
        targetCase,
        error as Error,
        userId,
      );

      await AuditService.createRotationEvent(
        testId,
        fromCase,
        targetCase,
        triggeredBy,
        false,
        duration,
        userId,
        message,
      );

      throw new Error(message);
    }
  }

  static async getTestsDueForRotation(): Promise<ScheduledRotation[]> {
    const now = new Date();
    const tests = await db.aBTest.findMany({
      where: {
        status: "ACTIVE",
        rotationHours: { gt: 0 },
        nextRotation: { lte: now },
      },
      orderBy: { nextRotation: "asc" },
      select: {
        id: true,
        shop: true,
        productId: true,
        currentCase: true,
        rotationHours: true,
        nextRotation: true,
      },
    });

    return tests.map((test) => ({
      id: test.id,
      shop: test.shop,
      productId: test.productId,
      currentCase: this.coerceCase(test.currentCase),
      rotationHours: test.rotationHours,
      nextRotation: test.nextRotation,
    }));
  }

  static async getRotationState(
		productId: string,
  ): Promise<{ testId: string | null; activeCase: TestCase | null }> {
    const test = await db.aBTest.findFirst({
      where: {
        productId,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, currentCase: true },
    });

    if (!test) {
      return { testId: null, activeCase: null };
    }

    return {
      testId: test.id,
      activeCase: this.coerceCase(test.currentCase),
    };
  }

  static async startTest(testId: string, userId?: string): Promise<void> {
    const test = await db.aBTest.findUnique({ where: { id: testId } });
    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

		await db.aBTest.update({
			where: { id: testId },
			data: {
        status: "ACTIVE",
        nextRotation: this.nextRotationFromHours(test.rotationHours ?? 0),
			},
		});

    await AuditService.logTestStatusChange(
      testId,
      test.shop,
      "DRAFT",
      "ACTIVE",
      userId,
    );
  }

  static async pauseTest(
    testId: string,
    userId?: string,
    admin?: AdminApiContext,
  ): Promise<void> {
    const test = await db.aBTest.findUnique({ where: { id: testId } });
    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    if (test.currentCase !== "BASE" && admin) {
      await this.rotateTest(testId, "MANUAL", userId, admin, "BASE");
		}

		await db.aBTest.update({
			where: { id: testId },
			data: {
        status: "PAUSED",
        nextRotation: null,
			},
		});

    await AuditService.logTestStatusChange(
      testId,
      test.shop,
      "ACTIVE",
      "PAUSED",
      userId,
    );
  }

  static async completeTest(
    testId: string,
    admin: AdminApiContext,
    userId?: string,
  ): Promise<void> {
		const test = await db.aBTest.findUnique({
			where: { id: testId },
      select: { shop: true, currentCase: true, status: true },
		});

		if (!test) {
			throw new Error(`Test ${testId} not found`);
		}

    if (test.currentCase === "TEST") {
      await this.rotateTest(testId, "SYSTEM", userId, admin, "BASE");
		}

		await db.aBTest.update({
			where: { id: testId },
			data: {
        status: "COMPLETED",
				nextRotation: null,
			},
		});

    await AuditService.logTestStatusChange(
      testId,
      test.shop,
      test.status,
      "COMPLETED",
      userId,
    );
  }

  private static requireAdmin(admin?: AdminApiContext): AdminApiContext {
    if (!admin) {
      throw new Error("Admin context required for rotation");
    }
    return admin;
  }

  private static coerceCase(value: string | null | undefined): TestCase {
    return value === "TEST" ? "TEST" : "BASE";
  }

  private static nextRotationFromHours(hours: number): Date | null {
    if (!hours || hours <= 0) {
      return null;
    }

    return new Date(Date.now() + hours * 60 * 60 * 1000);
	}
}
