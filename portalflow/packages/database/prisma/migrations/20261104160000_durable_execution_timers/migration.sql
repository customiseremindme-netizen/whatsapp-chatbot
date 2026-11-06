-- AlterTable
ALTER TABLE "BotExecution" ADD COLUMN     "waitExpiresAt" TIMESTAMP(3),
ADD COLUMN     "wakeAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "BotExecution_status_wakeAt_idx" ON "BotExecution"("status", "wakeAt");

-- CreateIndex
CREATE INDEX "BotExecution_status_waitExpiresAt_idx" ON "BotExecution"("status", "waitExpiresAt");

-- Preserve the previous default for existing questions, including paused questions.
UPDATE "BotExecution"
SET "waitExpiresAt" = "updatedAt" + INTERVAL '24 hours'
WHERE status IN ('WAITING', 'PAUSED') AND "waitingKey" IS NOT NULL;
