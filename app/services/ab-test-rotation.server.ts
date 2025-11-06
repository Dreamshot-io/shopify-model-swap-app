/**
 * Rotation engine orchestrates scheduled control/test switches by coordinating datastore locks and
 * delegating media swaps to provider-specific executors. It exposes a cron-friendly entry point and
 * summarises successes/failures for observability.
 */
import type { Prisma, RotationSlot } from '@prisma/client';
import { RotationTrigger, RotationVariant } from '@prisma/client';
import db from '../db.server';
import {
  getRotationSlotsDue,
  recordRotationHistory,
  updateRotationSlot,
} from './ab-test-rotation.store';

const PROCESSING_LOCK_BUFFER_MINUTES = 60;

type FullRotationSlot = Prisma.RotationSlotGetPayload<{
  include: {
    test: true;
    variantA: true;
    variantB: true;
  };
}>;

export interface RotationSwapSuccess {
  outcome: 'success';
  context?: Record<string, unknown>;
}

export interface RotationSwapFailure {
  outcome: 'failure';
  message: string;
  retryAt?: Date;
  context?: Record<string, unknown>;
}

export type RotationSwapResult = RotationSwapSuccess | RotationSwapFailure;

export interface RotationSwapParams {
  slot: FullRotationSlot;
  currentVariant: RotationVariant;
  targetVariant: RotationVariant;
}

export type RotationSwapExecutor = (params: RotationSwapParams) => Promise<RotationSwapResult>;

export interface RotationEngineDependencies {
  executeSwap: RotationSwapExecutor;
  now?: () => Date;
}

export interface RotationEngineSummary {
  processed: number;
  skipped: number;
  succeeded: Array<{ slotId: string; variant: RotationVariant }>;
  failed: Array<{ slotId: string; variant: RotationVariant; message: string }>;
}

export async function processDueRotations(
  deps: RotationEngineDependencies,
): Promise<RotationEngineSummary> {
  const clock = deps.now ?? (() => new Date());
  const now = clock();
  const dueSlots = await getRotationSlotsDue(now);
  const summary: RotationEngineSummary = {
    processed: 0,
    skipped: 0,
    succeeded: [],
    failed: [],
  };

  for (const slot of dueSlots) {
    const locked = await acquireSlotLock(slot.id, now);
    if (!locked) {
      summary.skipped += 1;
      continue;
    }

    const freshSlot = await fetchSlotWithRelations(slot.id);
    if (!freshSlot) {
      summary.skipped += 1;
      continue;
    }

    const targetVariant = nextVariant(freshSlot.activeVariant);
    const result = await deps.executeSwap({
      slot: freshSlot,
      currentVariant: freshSlot.activeVariant,
      targetVariant,
    });

    summary.processed += 1;

    if (result.outcome === 'success') {
      await finalizeSuccessfulSwitch(freshSlot, targetVariant, now, result.context);
      summary.succeeded.push({ slotId: freshSlot.id, variant: targetVariant });
      continue;
    }

    await releaseFailedSwitch(freshSlot, now, result.retryAt);
    summary.failed.push({
      slotId: freshSlot.id,
      variant: targetVariant,
      message: result.message,
    });
  }

  return summary;
}

async function acquireSlotLock(slotId: string, at: Date): Promise<boolean> {
  const lockUntil = addMinutes(at, PROCESSING_LOCK_BUFFER_MINUTES);
  const updated = await db.rotationSlot.updateMany({
    where: {
      id: slotId,
      nextSwitchDueAt: {
        lte: at,
      },
    },
    data: {
      nextSwitchDueAt: lockUntil,
    },
  });

  return updated === 1;
}

async function fetchSlotWithRelations(slotId: string): Promise<FullRotationSlot | null> {
  return db.rotationSlot.findUnique({
    where: { id: slotId },
    include: {
      test: true,
      variantA: true,
      variantB: true,
    },
  });
}

function nextVariant(current: RotationVariant): RotationVariant {
  return current === RotationVariant.CONTROL ? RotationVariant.TEST : RotationVariant.CONTROL;
}

async function finalizeSuccessfulSwitch(
  slot: RotationSlot,
  variant: RotationVariant,
  switchedAt: Date,
  context?: Record<string, unknown>,
) {
  const nextDue = addMinutes(switchedAt, slot.intervalMinutes);

  await updateRotationSlot(slot.id, {
    activeVariant: variant,
    lastSwitchAt: switchedAt,
    nextSwitchDueAt: nextDue,
  });

  await recordRotationHistory({
    slotId: slot.id,
    switchedVariant: variant,
    triggeredBy: RotationTrigger.CRON,
    switchedAt,
    context,
  });
}

async function releaseFailedSwitch(slot: RotationSlot, attemptedAt: Date, retryAt?: Date) {
  const fallbackDue = retryAt ?? addMinutes(attemptedAt, slot.intervalMinutes);

  await updateRotationSlot(slot.id, {
    nextSwitchDueAt: fallbackDue,
    lastSwitchAt: attemptedAt,
  });
}

function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}
