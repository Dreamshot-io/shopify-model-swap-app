-- Remove unique constraint on apiKey to allow multiple shops with same public app key
ALTER TABLE "ShopCredential" DROP CONSTRAINT IF EXISTS "ShopCredential_apiKey_key";

-- Add regular index for apiKey lookups (replaces unique constraint)
CREATE INDEX IF NOT EXISTS "ShopCredential_apiKey_idx" ON "ShopCredential"("apiKey");

-- The composite unique on (shopDomain, apiKey) remains to prevent duplicates per shop

