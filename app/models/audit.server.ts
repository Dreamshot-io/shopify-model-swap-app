/**
 * Helper functions for audit logging that don't fit into specific AuditService methods
 */

import type db from "../db.server";
import { lookupShopId } from "../db.server";

export interface CreateAuditLogParams {
  testId?: string;
  entityType: string;
  eventType: string;
  shop: string;
  shopId?: string;
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
  const shopId = params.shopId || await lookupShopId(params.shop);
  if (!shopId) {
    throw new Error(`Unable to resolve shopId for shop: ${params.shop}`);
  }

  return await prisma.auditLog.create({
    data: {
      testId: params.testId,
      entityType: params.entityType,
      eventType: params.eventType,
      shop: params.shop,
      shopId,
      description: params.description,
      metadata: params.metadata || {},
      userId: params.userId,
    },
  });
}
