-- Add new gallery-based fields to ABTest
ALTER TABLE "ABTest"
ADD COLUMN "baseMediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "testMediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Create TestMedia table for tracking media
CREATE TABLE "TestMedia" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "testCase" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sourceUrl" TEXT,
    "migratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestMedia_pkey" PRIMARY KEY ("id")
);

-- Add new gallery-based fields to ABTestVariant
ALTER TABLE "ABTestVariant"
ADD COLUMN "baseHeroMediaId" TEXT,
ADD COLUMN "testHeroMediaId" TEXT;

-- Create unique index for TestMedia
CREATE UNIQUE INDEX "TestMedia_testId_mediaId_key" ON "TestMedia"("testId", "mediaId");

-- Create index for TestMedia queries
CREATE INDEX "TestMedia_testId_testCase_idx" ON "TestMedia"("testId", "testCase");

-- Add foreign key constraint
ALTER TABLE "TestMedia" ADD CONSTRAINT "TestMedia_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;