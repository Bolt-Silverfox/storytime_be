-- CreateIndex
CREATE INDEX "activity_logs_action_isDeleted_createdAt_idx" ON "activity_logs"("action", "isDeleted", "createdAt" DESC);
