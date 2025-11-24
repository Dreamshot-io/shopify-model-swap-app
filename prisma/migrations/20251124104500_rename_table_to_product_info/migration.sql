-- Rename table ProductImageBackup to ProductInfo in the database
ALTER TABLE "ProductImageBackup" RENAME TO "ProductInfo";

-- Rename indexes to match new table name
ALTER INDEX IF EXISTS "ProductImageBackup_shop_mediaId_key" RENAME TO "ProductInfo_shop_mediaId_key";
ALTER INDEX IF EXISTS "ProductImageBackup_shop_productId_idx" RENAME TO "ProductInfo_shop_productId_idx";
ALTER INDEX IF EXISTS "ProductImageBackup_shopId_idx" RENAME TO "ProductInfo_shopId_idx";
ALTER INDEX IF EXISTS "ProductImageBackup_deletedAt_idx" RENAME TO "ProductInfo_deletedAt_idx";

-- Rename the foreign key constraint
ALTER TABLE "ProductInfo" RENAME CONSTRAINT "ProductImageBackup_shopId_fkey" TO "ProductInfo_shopId_fkey";

-- Rename the implicit many-to-many relation table if it exists
-- (The relation between VariantDailyStatistics and ProductInfo)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_ProductImageBackupToVariantDailyStatistics') THEN
        ALTER TABLE "_ProductImageBackupToVariantDailyStatistics" RENAME TO "_ProductInfoToVariantDailyStatistics";
    END IF;
END $$;
