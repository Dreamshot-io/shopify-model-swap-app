-- Rename ProductImageBackup to ProductInfo (model rename, keep table name via @@map)
-- This migration:
-- 1. Removes variantId column (images are product-level, not variant-level)
-- 2. Makes mediaId and shopifyUrl nullable (to match DB reality)
-- 3. Adds new columns: tags, taggedAt, taggingError, strategicRationale, deletedAt
-- 4. Hard deletes rows with NULL mediaId (invalid data)
-- 5. Updates indexes

-- Step 1: Hard delete rows with NULL mediaId (these are invalid/orphan records)
DELETE FROM "ProductImageBackup" WHERE "mediaId" IS NULL;

-- Step 2: Drop the variantId index before dropping the column
DROP INDEX IF EXISTS "ProductImageBackup_shop_variantId_idx";

-- Step 3: Drop variantId column (no longer needed - media is product-level)
ALTER TABLE "ProductImageBackup" DROP COLUMN IF EXISTS "variantId";

-- Step 4: Make mediaId nullable (if not already - for product-level entries without specific media)
ALTER TABLE "ProductImageBackup" ALTER COLUMN "mediaId" DROP NOT NULL;

-- Step 5: Make shopifyUrl nullable (if not already)
ALTER TABLE "ProductImageBackup" ALTER COLUMN "shopifyUrl" DROP NOT NULL;

-- Step 6: Add tags column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProductImageBackup' AND column_name = 'tags') THEN
        ALTER TABLE "ProductImageBackup" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
    END IF;
END $$;

-- Step 7: Add taggedAt column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProductImageBackup' AND column_name = 'taggedAt') THEN
        ALTER TABLE "ProductImageBackup" ADD COLUMN "taggedAt" TIMESTAMPTZ(6);
    END IF;
END $$;

-- Step 8: Add taggingError column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProductImageBackup' AND column_name = 'taggingError') THEN
        ALTER TABLE "ProductImageBackup" ADD COLUMN "taggingError" TEXT;
    END IF;
END $$;

-- Step 9: Add strategicRationale column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProductImageBackup' AND column_name = 'strategicRationale') THEN
        ALTER TABLE "ProductImageBackup" ADD COLUMN "strategicRationale" TEXT;
    END IF;
END $$;

-- Step 10: Add deletedAt column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProductImageBackup' AND column_name = 'deletedAt') THEN
        ALTER TABLE "ProductImageBackup" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
    END IF;
END $$;

-- Step 11: Add index on deletedAt for soft-delete queries (if not exists)
CREATE INDEX IF NOT EXISTS "ProductImageBackup_deletedAt_idx" ON "ProductImageBackup"("deletedAt");

-- Note: Table remains named "ProductImageBackup" in DB, but Prisma model is renamed to "ProductInfo" via @@map
-- This avoids any data loss from DROP TABLE / CREATE TABLE
