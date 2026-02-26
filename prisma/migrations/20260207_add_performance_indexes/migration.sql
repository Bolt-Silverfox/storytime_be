-- Add performance indexes

-- Story: index on createdAt for ordering
CREATE INDEX IF NOT EXISTS "stories_createdAt_idx" ON "stories"("createdAt");

-- StoryProgress: composite index on kidId + completed for common filter
CREATE INDEX IF NOT EXISTS "story_progress_kidId_completed_idx" ON "story_progress"("kidId", "completed");
