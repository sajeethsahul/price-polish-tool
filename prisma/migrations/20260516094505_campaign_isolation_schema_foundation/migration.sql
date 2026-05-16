-- AlterTable
ALTER TABLE "PriceHistory" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "revertStatus" TEXT,
ADD COLUMN     "revertedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ScheduledJob" ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "StagedPrice" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Pricing Campaign',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "runAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_shop_idx" ON "Campaign"("shop");

-- CreateIndex
CREATE INDEX "Campaign_shop_status_idx" ON "Campaign"("shop", "status");

-- CreateIndex
CREATE INDEX "Campaign_shop_runAt_idx" ON "Campaign"("shop", "runAt");

-- CreateIndex
CREATE INDEX "PriceHistory_shop_campaignId_idx" ON "PriceHistory"("shop", "campaignId");

-- CreateIndex
CREATE INDEX "PriceHistory_shop_batchId_idx" ON "PriceHistory"("shop", "batchId");

-- CreateIndex
CREATE INDEX "PriceHistory_campaignId_idx" ON "PriceHistory"("campaignId");

-- CreateIndex
CREATE INDEX "ScheduledJob_shop_campaignId_idx" ON "ScheduledJob"("shop", "campaignId");

-- CreateIndex
CREATE INDEX "ScheduledJob_campaignId_idx" ON "ScheduledJob"("campaignId");

-- CreateIndex
CREATE INDEX "StagedPrice_shop_campaignId_idx" ON "StagedPrice"("shop", "campaignId");

-- CreateIndex
CREATE INDEX "StagedPrice_campaignId_idx" ON "StagedPrice"("campaignId");

-- CreateIndex
CREATE INDEX "StagedPrice_shop_variantId_idx" ON "StagedPrice"("shop", "variantId");
