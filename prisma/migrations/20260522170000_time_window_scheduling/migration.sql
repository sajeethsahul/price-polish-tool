-- Additive fields for operational pricing windows.
ALTER TABLE "Campaign"
ADD COLUMN "windowEndAt" TIMESTAMP(3);

ALTER TABLE "ScheduledJob"
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'one-time',
ADD COLUMN "windowEndAt" TIMESTAMP(3),
ADD COLUMN "activatedAt" TIMESTAMP(3),
ADD COLUMN "restoredAt" TIMESTAMP(3);

CREATE INDEX "ScheduledJob_shop_status_windowEndAt_idx"
ON "ScheduledJob"("shop", "status", "windowEndAt");
