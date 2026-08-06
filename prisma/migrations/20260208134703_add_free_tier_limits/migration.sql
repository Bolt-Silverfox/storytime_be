-- AlterTable
ALTER TABLE "user_usages" ADD COLUMN     "bonusStories" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastBonusGrantedAt" TIMESTAMP(3),
ADD COLUMN     "selectedSecondVoiceId" TEXT,
ADD COLUMN     "uniqueStoriesRead" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "activity_logs_kidId_createdAt_idx" ON "activity_logs"("kidId", "createdAt");

-- CreateIndex
CREATE INDEX "users_email_isDeleted_idx" ON "users"("email", "isDeleted");
