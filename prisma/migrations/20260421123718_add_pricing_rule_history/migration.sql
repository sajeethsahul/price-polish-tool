-- CreateTable
CREATE TABLE "PricingRuleHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "markupPercent" DOUBLE PRECISION NOT NULL,
    "charmPricing" BOOLEAN NOT NULL,
    "roundingStep" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRuleHistory_pkey" PRIMARY KEY ("id")
);
