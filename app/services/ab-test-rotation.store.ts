/**
 * Provides persistence helpers for server-driven A/B test rotations, including slot lifecycle
 * management and switch history utilities used by the rotation engine and attribution layer.
 */
import type { Prisma, RotationHistory, RotationSlot } from '@prisma/client';
import { RotationTrigger, RotationVariant, RotationSlotStatus } from '@prisma/client';
import db from '../db.server';

export interface RotationMediaItem {
  id: string;
  url: string;
  position: number;
  altText?: string | null;
  metafieldId?: string | null;
  variantIds?: string[];
}

export interface RotationSlotCreateInput {
  shop: string;
  productId: string;
  shopifyVariantId?: string | null;
  testId: string;
  variantAId?: string | null;
  variantBId?: string | null;
  controlMedia: RotationMediaItem[];
  testMedia: RotationMediaItem[];
  intervalMinutes?: number;
  metadata?: Record<string, unknown> | null;
  activeVariant?: RotationVariant;
  nextSwitchDueAt?: Date | null;
}

export interface RotationSlotUpdateInput {
  status?: RotationSlotStatus;
  activeVariant?: RotationVariant;
  lastSwitchAt?: Date | null;
  nextSwitchDueAt?: Date | null;
  controlMedia?: RotationMediaItem[];
  testMedia?: RotationMediaItem[];
  metadata?: Record<string, unknown> | null;
  intervalMinutes?: number;
}

export interface RotationHistoryCreateInput {
  slotId: string;
  switchedVariant: RotationVariant;
  triggeredBy: RotationTrigger;
  switchedAt?: Date;
  context?: Record<string, unknown> | null;
}

export async function createRotationSlot(input: RotationSlotCreateInput): Promise<RotationSlot> {
  return db.rotationSlot.create({
    data: {
      shop: input.shop,
      productId: input.productId,
      shopifyVariantId: input.shopifyVariantId ?? null,
      testId: input.testId,
      variantAId: input.variantAId ?? null,
      variantBId: input.variantBId ?? null,
      controlMedia: input.controlMedia,
      testMedia: input.testMedia,
      intervalMinutes: input.intervalMinutes ?? 10,
      metadata: input.metadata ?? null,
      activeVariant: input.activeVariant ?? RotationVariant.CONTROL,
      nextSwitchDueAt: input.nextSwitchDueAt ?? null,
    },
  });
}

export async function updateRotationSlot(slotId: string, input: RotationSlotUpdateInput): Promise<RotationSlot> {
  const data: Prisma.RotationSlotUpdateInput = {};

  if (input.status !== undefined) data.status = input.status;
  if (input.activeVariant !== undefined) data.activeVariant = input.activeVariant;
  if (input.lastSwitchAt !== undefined) data.lastSwitchAt = input.lastSwitchAt ?? null;
  if (input.nextSwitchDueAt !== undefined) data.nextSwitchDueAt = input.nextSwitchDueAt ?? null;
  if (input.controlMedia !== undefined) data.controlMedia = input.controlMedia;
  if (input.testMedia !== undefined) data.testMedia = input.testMedia;
  if (input.metadata !== undefined) data.metadata = input.metadata ?? null;
  if (input.intervalMinutes !== undefined) data.intervalMinutes = input.intervalMinutes;

  return db.rotationSlot.update({
    where: { id: slotId },
    data,
  });
}

export async function getRotationSlotById(slotId: string): Promise<RotationSlot | null> {
  return db.rotationSlot.findUnique({ where: { id: slotId } });
}

export async function getRotationSlotByProduct(
  shop: string,
  productId: string,
  shopifyVariantId?: string | null,
): Promise<RotationSlot | null> {
  return db.rotationSlot.findUnique({
    where: {
      shop_productId_shopifyVariantId: {
        shop,
        productId,
        shopifyVariantId: shopifyVariantId ?? null,
      },
    },
  });
}

export async function getRotationSlotsDue(reference: Date): Promise<RotationSlot[]> {
  return db.rotationSlot.findMany({
    where: {
      nextSwitchDueAt: {
        lte: reference,
      },
      status: RotationSlotStatus.ACTIVE,
    },
  });
}

export async function recordRotationHistory(input: RotationHistoryCreateInput): Promise<RotationHistory> {
  return db.rotationHistory.create({
    data: {
      slotId: input.slotId,
      switchedVariant: input.switchedVariant,
      triggeredBy: input.triggeredBy,
      switchedAt: input.switchedAt ?? new Date(),
      context: input.context ?? null,
    },
  });
}

export async function getRotationTimeline(slotId: string, limit = 50): Promise<RotationHistory[]> {
  return db.rotationHistory.findMany({
    where: { slotId },
    orderBy: { switchedAt: 'desc' },
    take: limit,
  });
}

export async function variantAtTimestamp(
  slotId: string,
  at: Date,
): Promise<RotationVariant | null> {
  const entry = await db.rotationHistory.findFirst({
    where: {
      slotId,
      switchedAt: {
        lte: at,
      },
    },
    orderBy: { switchedAt: 'desc' },
  });

  if (!entry) {
    const slot = await getRotationSlotById(slotId);
    return slot?.activeVariant ?? null;
  }

  return entry.switchedVariant;
}
