-- Add shopId field to ABTestEvent for direct shop lookup
ALTER TABLE "ABTestEvent" ADD COLUMN "shopId" TEXT;

-- Create index for querying events by shop
CREATE INDEX "ABTestEvent_shopId_createdAt_idx" ON "ABTestEvent"("shopId", "createdAt");

-- Add foreign key constraint
ALTER TABLE "ABTestEvent" ADD CONSTRAINT "ABTestEvent_shopId_fkey" 
  FOREIGN KEY ("shopId") REFERENCES "ShopCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
