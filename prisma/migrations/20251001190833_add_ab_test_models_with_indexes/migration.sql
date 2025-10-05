-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "trafficSplit" INTEGER NOT NULL DEFAULT 50,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ABTestVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "imageUrls" TEXT NOT NULL,
    CONSTRAINT "ABTestVariant_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ABTestEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "revenue" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ABTestEvent_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ABTest_shop_status_idx" ON "ABTest"("shop", "status");

-- CreateIndex
CREATE INDEX "ABTest_shop_productId_idx" ON "ABTest"("shop", "productId");

-- CreateIndex
CREATE INDEX "ABTest_status_startDate_idx" ON "ABTest"("status", "startDate");

-- CreateIndex
CREATE INDEX "ABTestVariant_testId_variant_idx" ON "ABTestVariant"("testId", "variant");

-- CreateIndex
CREATE INDEX "ABTestEvent_testId_sessionId_idx" ON "ABTestEvent"("testId", "sessionId");

-- CreateIndex
CREATE INDEX "ABTestEvent_testId_eventType_idx" ON "ABTestEvent"("testId", "eventType");

-- CreateIndex
CREATE INDEX "ABTestEvent_testId_createdAt_idx" ON "ABTestEvent"("testId", "createdAt");
