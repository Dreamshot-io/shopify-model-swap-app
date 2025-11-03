-- Force add all missing columns for variant-scoped A/B testing

-- 1. Add variantScope to ABTest if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ABTest' AND column_name = 'variantScope'
    ) THEN
        ALTER TABLE "ABTest" ADD COLUMN "variantScope" TEXT DEFAULT 'PRODUCT';
    END IF;
END $$;

-- 2. Add shopifyVariantId to ABTestVariant if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ABTestVariant' AND column_name = 'shopifyVariantId'
    ) THEN
        ALTER TABLE "ABTestVariant" ADD COLUMN "shopifyVariantId" TEXT;
    END IF;
END $$;

-- 3. Add variantId to ABTestEvent if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ABTestEvent' AND column_name = 'variantId'
    ) THEN
        ALTER TABLE "ABTestEvent" ADD COLUMN "variantId" TEXT;
    END IF;
END $$;

-- Verify columns were added
SELECT 'ABTest.variantScope' as column_check, 
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'ABTest' AND column_name = 'variantScope') as exists;
       
SELECT 'ABTestVariant.shopifyVariantId' as column_check,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'ABTestVariant' AND column_name = 'shopifyVariantId') as exists;
       
SELECT 'ABTestEvent.variantId' as column_check,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'ABTestEvent' AND column_name = 'variantId') as exists;
