-- Create enums for rotation management
CREATE TYPE "RotationSlotStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "RotationVariant" AS ENUM ('CONTROL', 'TEST');
CREATE TYPE "RotationTrigger" AS ENUM ('CRON', 'MANUAL', 'ROLLBACK');

-- Core rotation slot table tracking state per product/variant
CREATE TABLE "RotationSlot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "testId" TEXT NOT NULL,
    "variantAId" TEXT,
    "variantBId" TEXT,
    "status" "RotationSlotStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeVariant" "RotationVariant" NOT NULL DEFAULT 'CONTROL',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 10,
    "lastSwitchAt" TIMESTAMP(3),
    "nextSwitchDueAt" TIMESTAMP(3),
    "controlMedia" JSONB NOT NULL,
    "testMedia" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RotationSlot_pkey" PRIMARY KEY ("id")
);

-- Track every executed switch for auditing and attribution
CREATE TABLE "RotationHistory" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "switchedVariant" "RotationVariant" NOT NULL,
    "triggeredBy" "RotationTrigger" NOT NULL,
    "switchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" JSONB,
    CONSTRAINT "RotationHistory_pkey" PRIMARY KEY ("id")
);

-- Relations
ALTER TABLE "RotationSlot"
    ADD CONSTRAINT "RotationSlot_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RotationSlot"
    ADD CONSTRAINT "RotationSlot_variantAId_fkey" FOREIGN KEY ("variantAId") REFERENCES "ABTestVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RotationSlot"
    ADD CONSTRAINT "RotationSlot_variantBId_fkey" FOREIGN KEY ("variantBId") REFERENCES "ABTestVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RotationHistory"
    ADD CONSTRAINT "RotationHistory_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "RotationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "RotationSlot_shop_productId_shopifyVariantId_key"
    ON "RotationSlot"("shop", "productId", "shopifyVariantId");

CREATE INDEX "RotationSlot_shop_nextSwitchDueAt_idx"
    ON "RotationSlot"("shop", "nextSwitchDueAt");

CREATE INDEX "RotationSlot_testId_idx"
    ON "RotationSlot"("testId");

CREATE INDEX "RotationHistory_slotId_switchedAt_idx"
    ON "RotationHistory"("slotId", "switchedAt");
