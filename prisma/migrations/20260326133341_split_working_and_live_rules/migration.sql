-- AlterTable
ALTER TABLE "PricingRule" ADD COLUMN "liveCharmPricing" BOOLEAN;
ALTER TABLE "PricingRule" ADD COLUMN "liveMarkupPercent" REAL;
ALTER TABLE "PricingRule" ADD COLUMN "liveRoundingStep" REAL;
