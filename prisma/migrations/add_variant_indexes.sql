-- Add indexes for optimized variant lookup queries

-- Composite index for finding variants by test + shopify variant
CREATE INDEX IF NOT EXISTS idx_ab_test_variant_lookup 
ON "ABTestVariant"("testId", "shopifyVariantId", "variant");

-- Index for filtering by shopifyVariantId
CREATE INDEX IF NOT EXISTS idx_ab_test_variant_shopify_id 
ON "ABTestVariant"("shopifyVariantId") 
WHERE "shopifyVariantId" IS NOT NULL;

-- Verify indexes created
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'ABTestVariant'
ORDER BY indexname;
