-- AlterTable: group batches belonging to the same logical publish operation.
-- Nullable — existing PushJob rows are unaffected (operationId = NULL = pre-batching era).
ALTER TABLE "PushJob"
ADD COLUMN "operationId" TEXT;
