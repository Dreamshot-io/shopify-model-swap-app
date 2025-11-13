/**
 * Helper functions for audit logging that don't fit into specific AuditService methods
 */

import db from "../db.server";

export interface CreateAuditLogParams {
  testId?: string;
  entityType: string;
  eventType: string;
  shop: string;
  description: string;
  metadata?: any;
  userId?: string;
}

/**
 * Generic audit log creation for custom events
 */
export async function createAuditLog(
  prisma: typeof db,
  params: CreateAuditLogParams
) {
  return await prisma.auditLog.create({
    data: {
      testId: params.testId,
      entityType: params.entityType,
      eventType: params.eventType,
      shop: params.shop,
      description: params.description,
      metadata: params.metadata || {},
      userId: params.userId,
    },
  });
}