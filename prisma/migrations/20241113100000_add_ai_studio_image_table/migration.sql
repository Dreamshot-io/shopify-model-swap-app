-- CreateTable
CREATE TABLE "AIStudioImage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mediaId" TEXT,
    "url" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "prompt" TEXT,
    "sourceImageUrl" TEXT,
    "aiProvider" TEXT,
    "variantIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIStudioImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIStudioImage_shop_productId_idx" ON "AIStudioImage"("shop", "productId");

-- CreateIndex
CREATE INDEX "AIStudioImage_shop_productId_state_idx" ON "AIStudioImage"("shop", "productId", "state");

-- CreateIndex
CREATE INDEX "AIStudioImage_createdAt_idx" ON "AIStudioImage"("createdAt");