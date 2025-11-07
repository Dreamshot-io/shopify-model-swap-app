-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "trafficSplit" INTEGER NOT NULL DEFAULT 50,
    "baseImages" JSONB NOT NULL,
    "testImages" JSONB NOT NULL,
    "currentCase" TEXT NOT NULL DEFAULT 'BASE',
    "rotationHours" INTEGER NOT NULL DEFAULT 24,
    "lastRotation" TIMESTAMP(3),
    "nextRotation" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ABTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTestVariant" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "baseHeroImage" JSONB,
    "testHeroImage" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ABTestVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTestEvent" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "activeCase" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "revenue" DECIMAL(65,30),
    "quantity" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ABTestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "testId" TEXT,
    "entityType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "userId" TEXT,
    "shop" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationEvent" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "fromCase" TEXT NOT NULL,
    "toCase" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "userId" TEXT,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "duration" INTEGER NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RotationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT,
    "prompt" TEXT,
    "productId" TEXT,
    "imageUrl" TEXT,
    "duration" INTEGER,

    CONSTRAINT "MetricEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSuggestionRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceField" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "suggestionPrompt" TEXT NOT NULL,
    "maxSuggestions" INTEGER NOT NULL DEFAULT 3,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSuggestionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ABTest_shop_status_idx" ON "ABTest"("shop", "status");

-- CreateIndex
CREATE INDEX "ABTest_shop_productId_idx" ON "ABTest"("shop", "productId");

-- CreateIndex
CREATE INDEX "ABTest_nextRotation_idx" ON "ABTest"("nextRotation");

-- CreateIndex
CREATE INDEX "ABTestVariant_testId_idx" ON "ABTestVariant"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "ABTestVariant_testId_shopifyVariantId_key" ON "ABTestVariant"("testId", "shopifyVariantId");

-- CreateIndex
CREATE INDEX "ABTestEvent_testId_eventType_createdAt_idx" ON "ABTestEvent"("testId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ABTestEvent_testId_sessionId_idx" ON "ABTestEvent"("testId", "sessionId");

-- CreateIndex
CREATE INDEX "ABTestEvent_testId_activeCase_idx" ON "ABTestEvent"("testId", "activeCase");

-- CreateIndex
CREATE INDEX "AuditLog_testId_timestamp_idx" ON "AuditLog"("testId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_shop_eventType_timestamp_idx" ON "AuditLog"("shop", "eventType", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "AuditLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_timestamp_idx" ON "AuditLog"("entityType", "timestamp");

-- CreateIndex
CREATE INDEX "RotationEvent_testId_timestamp_idx" ON "RotationEvent"("testId", "timestamp");

-- CreateIndex
CREATE INDEX "RotationEvent_triggeredBy_timestamp_idx" ON "RotationEvent"("triggeredBy", "timestamp");

-- CreateIndex
CREATE INDEX "MetricEvent_shop_eventType_idx" ON "MetricEvent"("shop", "eventType");

-- CreateIndex
CREATE INDEX "MetricEvent_timestamp_idx" ON "MetricEvent"("timestamp");

-- CreateIndex
CREATE INDEX "ProductSuggestionRule_shop_isActive_priority_idx" ON "ProductSuggestionRule"("shop", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSuggestionRule_shop_name_key" ON "ProductSuggestionRule"("shop", "name");

-- CreateIndex
CREATE INDEX "GenerationHistory_shop_productId_idx" ON "GenerationHistory"("shop", "productId");

-- CreateIndex
CREATE INDEX "GenerationHistory_createdAt_idx" ON "GenerationHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "ABTestVariant" ADD CONSTRAINT "ABTestVariant_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABTestEvent" ADD CONSTRAINT "ABTestEvent_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationEvent" ADD CONSTRAINT "RotationEvent_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

