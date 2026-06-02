ALTER TABLE "PriceHistory"
ADD COLUMN IF NOT EXISTS "revertFailureReason" TEXT;

