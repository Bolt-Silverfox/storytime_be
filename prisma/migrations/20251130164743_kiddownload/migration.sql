-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "age_groups" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "badges" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "buddy_interactions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "daily_challenge_assignments" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "daily_challenges" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "favorites" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "kids" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "question_answers" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reward_redemptions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "rewards" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "screen_time_sessions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "story_audio_cache" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "story_branches" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "story_buddies" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "story_images" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "story_paths" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "story_progress" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "story_questions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_badges" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_ips" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "voices" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "kid_downloads" (
    "id" TEXT NOT NULL,
    "kidId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kid_downloads_kidId_storyId_key" ON "kid_downloads"("kidId", "storyId");

-- CreateIndex
CREATE INDEX "Category_isDeleted_idx" ON "Category"("isDeleted");

-- CreateIndex
CREATE INDEX "Theme_isDeleted_idx" ON "Theme"("isDeleted");

-- CreateIndex
CREATE INDEX "activity_logs_isDeleted_idx" ON "activity_logs"("isDeleted");

-- CreateIndex
CREATE INDEX "age_groups_isDeleted_idx" ON "age_groups"("isDeleted");

-- CreateIndex
CREATE INDEX "badges_isDeleted_idx" ON "badges"("isDeleted");

-- CreateIndex
CREATE INDEX "buddy_interactions_isDeleted_idx" ON "buddy_interactions"("isDeleted");

-- CreateIndex
CREATE INDEX "daily_challenge_assignments_isDeleted_idx" ON "daily_challenge_assignments"("isDeleted");

-- CreateIndex
CREATE INDEX "daily_challenges_isDeleted_idx" ON "daily_challenges"("isDeleted");

-- CreateIndex
CREATE INDEX "favorites_isDeleted_idx" ON "favorites"("isDeleted");

-- CreateIndex
CREATE INDEX "kids_isDeleted_idx" ON "kids"("isDeleted");

-- CreateIndex
CREATE INDEX "notification_preferences_isDeleted_idx" ON "notification_preferences"("isDeleted");

-- CreateIndex
CREATE INDEX "payment_methods_isDeleted_idx" ON "payment_methods"("isDeleted");

-- CreateIndex
CREATE INDEX "payment_transactions_isDeleted_idx" ON "payment_transactions"("isDeleted");

-- CreateIndex
CREATE INDEX "profiles_isDeleted_idx" ON "profiles"("isDeleted");

-- CreateIndex
CREATE INDEX "question_answers_isDeleted_idx" ON "question_answers"("isDeleted");

-- CreateIndex
CREATE INDEX "reward_redemptions_isDeleted_idx" ON "reward_redemptions"("isDeleted");

-- CreateIndex
CREATE INDEX "rewards_isDeleted_idx" ON "rewards"("isDeleted");

-- CreateIndex
CREATE INDEX "screen_time_sessions_isDeleted_idx" ON "screen_time_sessions"("isDeleted");

-- CreateIndex
CREATE INDEX "sessions_isDeleted_idx" ON "sessions"("isDeleted");

-- CreateIndex
CREATE INDEX "stories_isDeleted_idx" ON "stories"("isDeleted");

-- CreateIndex
CREATE INDEX "story_audio_cache_isDeleted_idx" ON "story_audio_cache"("isDeleted");

-- CreateIndex
CREATE INDEX "story_branches_isDeleted_idx" ON "story_branches"("isDeleted");

-- CreateIndex
CREATE INDEX "story_buddies_isDeleted_idx" ON "story_buddies"("isDeleted");

-- CreateIndex
CREATE INDEX "story_images_isDeleted_idx" ON "story_images"("isDeleted");

-- CreateIndex
CREATE INDEX "story_paths_isDeleted_idx" ON "story_paths"("isDeleted");

-- CreateIndex
CREATE INDEX "story_progress_isDeleted_idx" ON "story_progress"("isDeleted");

-- CreateIndex
CREATE INDEX "story_questions_isDeleted_idx" ON "story_questions"("isDeleted");

-- CreateIndex
CREATE INDEX "subscriptions_isDeleted_idx" ON "subscriptions"("isDeleted");

-- CreateIndex
CREATE INDEX "support_tickets_isDeleted_idx" ON "support_tickets"("isDeleted");

-- CreateIndex
CREATE INDEX "tokens_isDeleted_idx" ON "tokens"("isDeleted");

-- CreateIndex
CREATE INDEX "user_badges_isDeleted_idx" ON "user_badges"("isDeleted");

-- CreateIndex
CREATE INDEX "user_ips_isDeleted_idx" ON "user_ips"("isDeleted");

-- CreateIndex
CREATE INDEX "users_isDeleted_idx" ON "users"("isDeleted");

-- CreateIndex
CREATE INDEX "voices_isDeleted_idx" ON "voices"("isDeleted");

-- AddForeignKey
ALTER TABLE "kid_downloads" ADD CONSTRAINT "kid_downloads_kidId_fkey" FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_downloads" ADD CONSTRAINT "kid_downloads_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
