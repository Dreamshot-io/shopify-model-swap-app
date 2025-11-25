-- Allow same shop to have multiple app credentials (different apiKey per app)
-- Drop old unique constraint on shopDomain
DROP INDEX IF EXISTS "ShopCredential_shopDomain_key";

-- Add unique constraint on apiKey (each app has unique client_id)
ALTER TABLE "ShopCredential" ADD CONSTRAINT "ShopCredential_apiKey_key" UNIQUE ("apiKey");

-- Add composite unique constraint for shopDomain + apiKey
ALTER TABLE "ShopCredential" ADD CONSTRAINT "ShopCredential_shopDomain_apiKey_key" UNIQUE ("shopDomain", "apiKey");

-- Add index on shopDomain for lookups
CREATE INDEX IF NOT EXISTS "ShopCredential_shopDomain_idx" ON "ShopCredential"("shopDomain");
