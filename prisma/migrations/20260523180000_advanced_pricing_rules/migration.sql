ALTER TABLE "PricingRule"
ADD COLUMN "adjustmentType" TEXT NOT NULL DEFAULT 'percentage',
ADD COLUMN "adjustmentDirection" TEXT NOT NULL DEFAULT 'increase',
ADD COLUMN "adjustmentValue" DOUBLE PRECISION NOT NULL DEFAULT 10,
ADD COLUMN "endingOption" TEXT NOT NULL DEFAULT '0.99',
ADD COLUMN "roundingPrecision" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "minPrice" DOUBLE PRECISION,
ADD COLUMN "maxPrice" DOUBLE PRECISION,
ADD COLUMN "liveAdjustmentType" TEXT,
ADD COLUMN "liveAdjustmentDirection" TEXT,
ADD COLUMN "liveAdjustmentValue" DOUBLE PRECISION,
ADD COLUMN "liveEndingOption" TEXT,
ADD COLUMN "liveRoundingPrecision" TEXT,
ADD COLUMN "liveMinPrice" DOUBLE PRECISION,
ADD COLUMN "liveMaxPrice" DOUBLE PRECISION;

ALTER TABLE "PricingRuleHistory"
ADD COLUMN "adjustmentType" TEXT,
ADD COLUMN "adjustmentDirection" TEXT,
ADD COLUMN "adjustmentValue" DOUBLE PRECISION,
ADD COLUMN "endingOption" TEXT,
ADD COLUMN "roundingPrecision" TEXT,
ADD COLUMN "minPrice" DOUBLE PRECISION,
ADD COLUMN "maxPrice" DOUBLE PRECISION;
