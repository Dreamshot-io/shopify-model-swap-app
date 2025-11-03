-- Add variantScope column to ABTest table if it doesn't exist
ALTER TABLE "ABTest" ADD COLUMN IF NOT EXISTS "variantScope" TEXT DEFAULT 'PRODUCT';

-- Update existing records to have PRODUCT scope
UPDATE "ABTest" SET "variantScope" = 'PRODUCT' WHERE "variantScope" IS NULL;

-- Add comment
COMMENT ON COLUMN "ABTest"."variantScope" IS 'Scope of the test: PRODUCT (all variants) or VARIANT (per-variant)';
