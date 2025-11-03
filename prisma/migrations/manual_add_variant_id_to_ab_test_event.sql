-- Add variantId column to ABTestEvent table if it doesn't exist
ALTER TABLE "ABTestEvent" ADD COLUMN IF NOT EXISTS "variantId" TEXT;

-- Add comment
COMMENT ON COLUMN "ABTestEvent"."variantId" IS 'Optional: Track which product variant was involved in the event';
