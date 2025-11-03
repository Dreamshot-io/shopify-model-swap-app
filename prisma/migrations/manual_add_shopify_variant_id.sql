-- Add shopifyVariantId column to ABTestVariant table if it doesn't exist
ALTER TABLE "ABTestVariant" ADD COLUMN IF NOT EXISTS "shopifyVariantId" TEXT;

-- Add comment
COMMENT ON COLUMN "ABTestVariant"."shopifyVariantId" IS 'Link to actual Shopify product variant for variant-scoped tests';
