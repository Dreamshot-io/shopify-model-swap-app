-- AlterTable
ALTER TABLE "ABTest" ALTER COLUMN "rotationHours" SET DATA TYPE DOUBLE PRECISION, ALTER COLUMN "rotationHours" SET DEFAULT 0.5;

-- Update existing records: convert 24 hours to 0.5 hours (30 minutes)
UPDATE "ABTest" SET "rotationHours" = 0.5 WHERE "rotationHours" = 24;
