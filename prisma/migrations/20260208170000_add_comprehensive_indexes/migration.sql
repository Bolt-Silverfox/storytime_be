-- Add comprehensive indexes for FK columns and query optimization
-- This migration adds ~70 indexes to improve JOIN and query performance

-- =============================================
-- USER MODEL INDEXES
-- =============================================
CREATE INDEX "users_avatarId_idx" ON "users"("avatarId");
CREATE INDEX "users_preferredVoiceId_idx" ON "users"("preferredVoiceId");
CREATE INDEX "users_role_isDeleted_idx" ON "users"("role", "isDeleted");

-- =============================================
-- KID MODEL INDEXES
-- =============================================
CREATE INDEX "kids_parentId_idx" ON "kids"("parentId");
CREATE INDEX "kids_parentId_isDeleted_idx" ON "kids"("parentId", "isDeleted");
CREATE INDEX "kids_avatarId_idx" ON "kids"("avatarId");
CREATE INDEX "kids_preferredVoiceId_idx" ON "kids"("preferredVoiceId");
CREATE INDEX "kids_storyBuddyId_idx" ON "kids"("storyBuddyId");

-- =============================================
-- STORY MODEL INDEXES
-- =============================================
CREATE INDEX "stories_creatorKidId_idx" ON "stories"("creatorKidId");
CREATE INDEX "stories_language_idx" ON "stories"("language");
CREATE INDEX "stories_aiGenerated_isDeleted_idx" ON "stories"("aiGenerated", "isDeleted");
CREATE INDEX "stories_recommended_isDeleted_idx" ON "stories"("recommended", "isDeleted");
CREATE INDEX "stories_ageMin_ageMax_idx" ON "stories"("ageMin", "ageMax");

-- =============================================
-- STORY RELATED TABLES
-- =============================================
CREATE INDEX "story_images_storyId_idx" ON "story_images"("storyId");
CREATE INDEX "story_branches_storyId_idx" ON "story_branches"("storyId");
CREATE INDEX "story_audio_cache_storyId_idx" ON "story_audio_cache"("storyId");
CREATE INDEX "story_questions_storyId_idx" ON "story_questions"("storyId");
CREATE INDEX "story_paths_kidId_idx" ON "story_paths"("kidId");
CREATE INDEX "story_paths_storyId_idx" ON "story_paths"("storyId");
CREATE INDEX "story_paths_kidId_storyId_idx" ON "story_paths"("kidId", "storyId");

-- =============================================
-- FAVORITES INDEXES
-- =============================================
CREATE INDEX "favorites_kidId_idx" ON "favorites"("kidId");
CREATE INDEX "favorites_storyId_idx" ON "favorites"("storyId");
CREATE INDEX "favorites_kidId_storyId_idx" ON "favorites"("kidId", "storyId");
CREATE INDEX "parent_favorites_userId_idx" ON "parent_favorites"("userId");
CREATE INDEX "parent_favorites_storyId_idx" ON "parent_favorites"("storyId");
CREATE INDEX "parent_favorites_isDeleted_idx" ON "parent_favorites"("isDeleted");

-- =============================================
-- PROGRESS TRACKING INDEXES
-- =============================================
CREATE INDEX "story_progress_kidId_idx" ON "story_progress"("kidId");
CREATE INDEX "story_progress_storyId_idx" ON "story_progress"("storyId");
CREATE INDEX "user_story_progress_userId_idx" ON "user_story_progress"("userId");
CREATE INDEX "user_story_progress_storyId_idx" ON "user_story_progress"("storyId");

-- =============================================
-- PAYMENT/SUBSCRIPTION INDEXES
-- =============================================
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");
CREATE INDEX "subscriptions_userId_status_idx" ON "subscriptions"("userId", "status");
CREATE INDEX "subscriptions_status_isDeleted_idx" ON "subscriptions"("status", "isDeleted");
CREATE INDEX "support_tickets_userId_idx" ON "support_tickets"("userId");
CREATE INDEX "support_tickets_status_isDeleted_idx" ON "support_tickets"("status", "isDeleted");
CREATE INDEX "payment_methods_userId_idx" ON "payment_methods"("userId");
CREATE INDEX "payment_methods_userId_isDeleted_idx" ON "payment_methods"("userId", "isDeleted");
CREATE INDEX "payment_transactions_userId_idx" ON "payment_transactions"("userId");
CREATE INDEX "payment_transactions_userId_status_idx" ON "payment_transactions"("userId", "status");
CREATE INDEX "payment_transactions_paymentMethodId_idx" ON "payment_transactions"("paymentMethodId");

-- =============================================
-- DAILY CHALLENGE INDEXES
-- =============================================
CREATE INDEX "daily_challenges_storyId_idx" ON "daily_challenges"("storyId");
CREATE INDEX "daily_challenges_challengeDate_idx" ON "daily_challenges"("challengeDate");
CREATE INDEX "daily_challenge_assignments_kidId_idx" ON "daily_challenge_assignments"("kidId");
CREATE INDEX "daily_challenge_assignments_challengeId_idx" ON "daily_challenge_assignments"("challengeId");
CREATE INDEX "daily_challenge_assignments_kidId_completed_idx" ON "daily_challenge_assignments"("kidId", "completed");

-- =============================================
-- VOICE MODEL INDEXES
-- =============================================
CREATE INDEX "voices_userId_idx" ON "voices"("userId");
CREATE INDEX "voices_type_isDeleted_idx" ON "voices"("type", "isDeleted");

-- =============================================
-- REWARD INDEXES
-- =============================================
CREATE INDEX "rewards_userId_idx" ON "rewards"("userId");
CREATE INDEX "rewards_kidId_idx" ON "rewards"("kidId");
CREATE INDEX "reward_redemptions_rewardId_idx" ON "reward_redemptions"("rewardId");
CREATE INDEX "reward_redemptions_kidId_idx" ON "reward_redemptions"("kidId");
CREATE INDEX "reward_redemptions_kidId_redeemedAt_idx" ON "reward_redemptions"("kidId", "redeemedAt");

-- =============================================
-- ACTIVITY LOG INDEXES
-- =============================================
CREATE INDEX "activity_logs_userId_idx" ON "activity_logs"("userId");
CREATE INDEX "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt");
CREATE INDEX "activity_logs_action_createdAt_idx" ON "activity_logs"("action", "createdAt");

-- =============================================
-- QUESTION/ANSWER INDEXES
-- =============================================
CREATE INDEX "question_answers_questionId_idx" ON "question_answers"("questionId");
CREATE INDEX "question_answers_storyId_idx" ON "question_answers"("storyId");

-- =============================================
-- SCREEN TIME INDEXES
-- =============================================
CREATE INDEX "screen_time_sessions_kidId_idx" ON "screen_time_sessions"("kidId");

-- =============================================
-- DOWNLOADED STORIES INDEXES
-- =============================================
CREATE INDEX "downloaded_stories_kidId_idx" ON "downloaded_stories"("kidId");
CREATE INDEX "downloaded_stories_storyId_idx" ON "downloaded_stories"("storyId");

-- =============================================
-- RESTRICTED STORIES INDEXES
-- =============================================
CREATE INDEX "restricted_stories_storyId_idx" ON "restricted_stories"("storyId");
CREATE INDEX "restricted_stories_userId_idx" ON "restricted_stories"("userId");
