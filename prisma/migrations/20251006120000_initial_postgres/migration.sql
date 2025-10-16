-- Initial Postgres baseline generated from current Prisma schema

-- CreateEnum for ABTestStatus
DO $$ BEGIN
  CREATE TYPE "ABTestStatus" AS ENUM ('DRAFT','RUNNING','PAUSED','COMPLETED','ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for ABTestEventType
DO $$ BEGIN
  CREATE TYPE "ABTestEventType" AS ENUM ('IMPRESSION','ADD_TO_CART','PURCHASE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum for EventType
DO $$ BEGIN
  CREATE TYPE "EventType" AS ENUM ('GENERATED','DRAFT_SAVED','DRAFT_DELETED','PUBLISHED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Session table
CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT FALSE,
  "scope" TEXT,
  "expires" TIMESTAMP,
  "accessToken" TEXT NOT NULL,
  "userId" BIGINT,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "accountOwner" BOOLEAN NOT NULL DEFAULT FALSE,
  "locale" TEXT,
  "collaborator" BOOLEAN DEFAULT FALSE,
  "emailVerified" BOOLEAN DEFAULT FALSE
);

-- MetricEvent table
CREATE TABLE IF NOT EXISTS "MetricEvent" (
  "id" TEXT PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "type" "EventType" NOT NULL,
  "productId" TEXT,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ABTest table
CREATE TABLE IF NOT EXISTS "ABTest" (
  "id" TEXT PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ABTestStatus" NOT NULL DEFAULT 'DRAFT',
  "trafficSplit" INTEGER NOT NULL DEFAULT 50,
  "startDate" TIMESTAMP,
  "endDate" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL
);

-- ABTestVariant table
CREATE TABLE IF NOT EXISTS "ABTestVariant" (
  "id" TEXT PRIMARY KEY,
  "testId" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "imageUrls" TEXT NOT NULL,
  CONSTRAINT "ABTestVariant_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ABTestEvent table
CREATE TABLE IF NOT EXISTS "ABTestEvent" (
  "id" TEXT PRIMARY KEY,
  "testId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "eventType" "ABTestEventType" NOT NULL,
  "productId" TEXT NOT NULL,
  "revenue" DECIMAL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "ABTestEvent_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS "ABTest_shop_status_idx" ON "ABTest"("shop", "status");
CREATE INDEX IF NOT EXISTS "ABTest_shop_productId_idx" ON "ABTest"("shop", "productId");
CREATE INDEX IF NOT EXISTS "ABTest_status_startDate_idx" ON "ABTest"("status", "startDate");
CREATE INDEX IF NOT EXISTS "ABTestVariant_testId_variant_idx" ON "ABTestVariant"("testId", "variant");
CREATE INDEX IF NOT EXISTS "ABTestEvent_testId_sessionId_idx" ON "ABTestEvent"("testId", "sessionId");
CREATE INDEX IF NOT EXISTS "ABTestEvent_testId_eventType_idx" ON "ABTestEvent"("testId", "eventType");
CREATE INDEX IF NOT EXISTS "ABTestEvent_testId_createdAt_idx" ON "ABTestEvent"("testId", "createdAt");
