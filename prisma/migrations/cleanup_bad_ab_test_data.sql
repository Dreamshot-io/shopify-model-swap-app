-- Delete ABTest records where variants have null or invalid imageUrls
DELETE FROM "ABTest" 
WHERE id IN (
    SELECT DISTINCT "testId" 
    FROM "ABTestVariant" 
    WHERE "imageUrls" IS NULL 
       OR "imageUrls" = '' 
       OR "imageUrls" = 'undefined'
);

-- Delete orphaned ABTestVariant records
DELETE FROM "ABTestVariant" 
WHERE "imageUrls" IS NULL 
   OR "imageUrls" = '' 
   OR "imageUrls" = 'undefined';

-- Verify cleanup
SELECT COUNT(*) as total_tests FROM "ABTest";
SELECT COUNT(*) as total_variants FROM "ABTestVariant";
SELECT COUNT(*) as bad_variants FROM "ABTestVariant" WHERE "imageUrls" IS NULL OR "imageUrls" = '' OR "imageUrls" = 'undefined';
