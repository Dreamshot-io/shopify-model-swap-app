-- CreateEnum
CREATE TYPE "ShopCredentialMode" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "ShopCredential" ADD COLUMN "mode" "ShopCredentialMode" NOT NULL DEFAULT 'PUBLIC';

-- Mark existing installations as PRIVATE to preserve current behavior
UPDATE "ShopCredential" SET "mode" = 'PRIVATE';

-- CreateIndex
CREATE INDEX "ShopCredential_mode_idx" ON "ShopCredential"("mode");
