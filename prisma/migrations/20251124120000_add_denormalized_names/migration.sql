-- Add denormalized name fields for external dashboard display

-- ShopCredential: add shopName
ALTER TABLE "ShopCredential" ADD COLUMN "shopName" TEXT;

-- ProductInfo: add productTitle, productHandle
ALTER TABLE "ProductInfo" ADD COLUMN "productTitle" TEXT;
ALTER TABLE "ProductInfo" ADD COLUMN "productHandle" TEXT;

-- StatisticsExport: add shopName, productTitle, variantTitle
ALTER TABLE "StatisticsExport" ADD COLUMN "shopName" TEXT;
ALTER TABLE "StatisticsExport" ADD COLUMN "productTitle" TEXT;
ALTER TABLE "StatisticsExport" ADD COLUMN "variantTitle" TEXT;

-- VariantDailyStatistics: add shopName, productTitle, variantTitle
ALTER TABLE "VariantDailyStatistics" ADD COLUMN "shopName" TEXT;
ALTER TABLE "VariantDailyStatistics" ADD COLUMN "productTitle" TEXT;
ALTER TABLE "VariantDailyStatistics" ADD COLUMN "variantTitle" TEXT;
