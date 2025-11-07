import { type ABTest, type AuditLog, type RotationEvent } from '@prisma/client';
import db from '../db.server';

// Comprehensive event types for audit logging
export enum AuditEventType {
  // Test lifecycle
  TEST_CREATED = 'TEST_CREATED',
  TEST_UPDATED = 'TEST_UPDATED',
  TEST_STARTED = 'TEST_STARTED',
  TEST_PAUSED = 'TEST_PAUSED',
  TEST_RESUMED = 'TEST_RESUMED',
  TEST_COMPLETED = 'TEST_COMPLETED',
  TEST_DELETED = 'TEST_DELETED',

  // Rotation events
  ROTATION_SCHEDULED = 'ROTATION_SCHEDULED',
  ROTATION_STARTED = 'ROTATION_STARTED',
  ROTATION_COMPLETED = 'ROTATION_COMPLETED',
  ROTATION_FAILED = 'ROTATION_FAILED',
  ROTATION_MANUAL_TRIGGER = 'ROTATION_MANUAL_TRIGGER',

  // Image management
  IMAGES_UPLOADED = 'IMAGES_UPLOADED',
  IMAGES_DELETED = 'IMAGES_DELETED',
  VARIANT_HERO_UPDATED = 'VARIANT_HERO_UPDATED',

  // System events
  CRON_JOB_RUN = 'CRON_JOB_RUN',
  WEBHOOK_RECEIVED = 'WEBHOOK_RECEIVED',
  PIXEL_INITIALIZED = 'PIXEL_INITIALIZED',
  API_ERROR = 'API_ERROR',

  // User actions
  USER_VIEWED_TEST = 'USER_VIEWED_TEST',
  USER_EXPORTED_DATA = 'USER_EXPORTED_DATA',
  SETTINGS_CHANGED = 'SETTINGS_CHANGED',
}

export enum EntityType {
  TEST = 'TEST',
  ROTATION = 'ROTATION',
  SYSTEM = 'SYSTEM',
  USER_ACTION = 'USER_ACTION',
}

export enum RotationTrigger {
  CRON = 'CRON',
  MANUAL = 'MANUAL',
  ROLLBACK = 'ROLLBACK',
  SYSTEM = 'SYSTEM',
}

export class AuditService {
  // Test lifecycle logging
  static async logTestCreated(
    test: Partial<ABTest>,
    userId: string,
    details?: any
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId: test.id,
        entityType: EntityType.TEST,
        eventType: AuditEventType.TEST_CREATED,
        userId,
        shop: test.shop!,
        description: `Test "${test.name}" created for product ${test.productId}`,
        metadata: {
          testName: test.name,
          productId: test.productId,
          imageCount: (test.testImages as any)?.length || 0,
          variantCount: 0,
          ...details,
        },
      },
    });
  }

  static async logTestUpdated(
    testId: string,
    shop: string,
    changes: any,
    userId?: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.TEST,
        eventType: AuditEventType.TEST_UPDATED,
        userId,
        shop,
        description: `Test updated: ${Object.keys(changes).join(', ')}`,
        metadata: { changes },
      },
    });
  }

  static async logTestStatusChange(
    testId: string,
    shop: string,
    fromStatus: string,
    toStatus: string,
    userId?: string
  ): Promise<AuditLog> {
    const eventTypeMap: Record<string, AuditEventType> = {
      ACTIVE: AuditEventType.TEST_STARTED,
      PAUSED: AuditEventType.TEST_PAUSED,
      COMPLETED: AuditEventType.TEST_COMPLETED,
    };

    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.TEST,
        eventType: eventTypeMap[toStatus] || AuditEventType.TEST_UPDATED,
        userId,
        shop,
        description: `Test status changed from ${fromStatus} to ${toStatus}`,
        metadata: { fromStatus, toStatus },
      },
    });
  }

  static async logTestDeleted(
    testId: string,
    testName: string,
    shop: string,
    userId?: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.TEST,
        eventType: AuditEventType.TEST_DELETED,
        userId,
        shop,
        description: `Test "${testName}" deleted`,
        metadata: { testName },
      },
    });
  }

  // Rotation event logging
  static async logRotationStarted(
    testId: string,
    shop: string,
    fromCase: string,
    toCase: string,
    triggeredBy: string,
    userId?: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.ROTATION,
        eventType: AuditEventType.ROTATION_STARTED,
        userId,
        shop,
        description: `Rotation started: ${fromCase} → ${toCase}`,
        metadata: { fromCase, toCase, triggeredBy },
      },
    });
  }

  static async logRotationCompleted(
    testId: string,
    shop: string,
    fromCase: string,
    toCase: string,
    duration: number,
    result?: any
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.ROTATION,
        eventType: AuditEventType.ROTATION_COMPLETED,
        shop,
        description: `Rotation completed successfully in ${duration}ms`,
        metadata: { fromCase, toCase, duration, ...result },
      },
    });
  }

  static async logRotationFailed(
    testId: string,
    shop: string,
    fromCase: string,
    toCase: string,
    error: Error,
    userId?: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.ROTATION,
        eventType: AuditEventType.ROTATION_FAILED,
        userId,
        shop,
        description: `Rotation failed: ${error.message}`,
        metadata: {
          fromCase,
          toCase,
          error: error.message,
          stack: error.stack,
        },
      },
    });
  }

  // Create rotation event record for attribution
  static async createRotationEvent(
    testId: string,
    fromCase: string,
    toCase: string,
    triggeredBy: string,
    success: boolean,
    duration: number,
    userId?: string,
    error?: string,
    metadata?: any
  ): Promise<RotationEvent> {
    return await db.rotationEvent.create({
      data: {
        testId,
        fromCase,
        toCase,
        triggeredBy,
        userId,
        success,
        error,
        duration,
        metadata: metadata || {},
      },
    });
  }

  // Image management logging
  static async logImagesUploaded(
    testId: string,
    shop: string,
    imageCount: number,
    mediaIds: string[],
    targetCase: string,
    userId?: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.ROTATION,
        eventType: AuditEventType.IMAGES_UPLOADED,
        userId,
        shop,
        description: `Updated ${imageCount} product images`,
        metadata: { mediaIds, targetCase, imageCount },
      },
    });
  }

  static async logVariantHeroUpdated(
    testId: string,
    shop: string,
    variantId: string,
    variantName: string,
    mediaId: string,
    targetCase: string,
    userId?: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.ROTATION,
        eventType: AuditEventType.VARIANT_HERO_UPDATED,
        userId,
        shop,
        description: `Updated hero for variant ${variantName}`,
        metadata: {
          variantId,
          variantName,
          mediaId,
          targetCase,
        },
      },
    });
  }

  // System event logging
  static async logCronJob(shop: string, results: any): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        entityType: EntityType.SYSTEM,
        eventType: AuditEventType.CRON_JOB_RUN,
        shop: shop || 'SYSTEM',
        description: `Cron job processed ${results.testsRotated || 0} tests`,
        metadata: results,
      },
    });
  }

  static async logWebhookReceived(
    shop: string,
    topic: string,
    orderId?: string,
    metadata?: any
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        entityType: EntityType.SYSTEM,
        eventType: AuditEventType.WEBHOOK_RECEIVED,
        shop,
        description: `Webhook received: ${topic}`,
        metadata: {
          topic,
          orderId,
          ...metadata,
        },
      },
    });
  }

  static async logApiError(
    shop: string,
    endpoint: string,
    error: Error,
    userId?: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        entityType: EntityType.SYSTEM,
        eventType: AuditEventType.API_ERROR,
        userId,
        shop,
        description: `API error at ${endpoint}: ${error.message}`,
        metadata: {
          endpoint,
          error: error.message,
          stack: error.stack,
        },
      },
    });
  }

  // User action logging
  static async logUserAction(
    action: string,
    userId: string,
    shop: string,
    details: any
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        entityType: EntityType.USER_ACTION,
        eventType: action as AuditEventType,
        userId,
        shop,
        description: `User ${userId} performed ${action}`,
        metadata: details,
      },
    });
  }

  static async logUserViewedTest(
    testId: string,
    userId: string,
    shop: string,
    page: string
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        testId,
        entityType: EntityType.USER_ACTION,
        eventType: AuditEventType.USER_VIEWED_TEST,
        userId,
        shop,
        description: `User viewed test on ${page} page`,
        metadata: {
          page,
          timestamp: new Date(),
        },
      },
    });
  }

  static async logDataExport(
    userId: string,
    shop: string,
    exportType: string,
    recordCount: number
  ): Promise<AuditLog> {
    return await db.auditLog.create({
      data: {
        entityType: EntityType.USER_ACTION,
        eventType: AuditEventType.USER_EXPORTED_DATA,
        userId,
        shop,
        description: `User exported ${recordCount} ${exportType} records`,
        metadata: {
          exportType,
          recordCount,
          timestamp: new Date(),
        },
      },
    });
  }

  // Query helpers
  static async getTestAuditLogs(
    testId: string,
    limit = 100
  ): Promise<AuditLog[]> {
    return await db.auditLog.findMany({
      where: { testId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  static async getRotationHistory(
    testId: string,
    limit = 50
  ): Promise<RotationEvent[]> {
    return await db.rotationEvent.findMany({
      where: { testId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  static async getSystemLogs(
    shop: string,
    eventTypes?: AuditEventType[],
    limit = 100
  ): Promise<AuditLog[]> {
    return await db.auditLog.findMany({
      where: {
        shop,
        entityType: EntityType.SYSTEM,
        ...(eventTypes && { eventType: { in: eventTypes } }),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  static async getUserActions(
    userId: string,
    shop: string,
    limit = 100
  ): Promise<AuditLog[]> {
    return await db.auditLog.findMany({
      where: {
        userId,
        shop,
        entityType: EntityType.USER_ACTION,
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  // Analytics helpers
  static async getRotationSuccessRate(
    testId?: string,
    days = 7
  ): Promise<{ successRate: number; total: number }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rotations = await db.rotationEvent.findMany({
      where: {
        ...(testId && { testId }),
        timestamp: { gte: since },
      },
    });

    const successful = rotations.filter((r) => r.success).length;
    return {
      successRate: rotations.length > 0 ? (successful / rotations.length) * 100 : 0,
      total: rotations.length,
    };
  }

  static async getAverageRotationDuration(
    testId?: string
  ): Promise<number> {
    const rotations = await db.rotationEvent.findMany({
      where: {
        ...(testId && { testId }),
        success: true,
      },
      select: { duration: true },
    });

    if (rotations.length === 0) return 0;

    const total = rotations.reduce((sum, r) => sum + r.duration, 0);
    return Math.round(total / rotations.length);
  }
}