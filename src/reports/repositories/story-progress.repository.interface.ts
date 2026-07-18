import type { StoryProgress } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IStoryProgressRepository {
  // Count completed stories for a kid within a date range (lastAccessed)
  countCompletedInRange(
    kidId: string,
    gte: Date,
    lt: Date,
  ): Promise<number>;

  // Count completed stories for a kid since a date (lastAccessed)
  countCompletedSince(kidId: string, gte: Date): Promise<number>;

  // Count in-progress (not completed) stories for a kid
  countInProgress(kidId: string): Promise<number>;

  // Upsert a completed progress record (progress 100) for a kid + story
  upsertCompletedProgress(
    kidId: string,
    storyId: string,
  ): Promise<StoryProgress>;
}

export const STORY_PROGRESS_REPOSITORY = Symbol('STORY_PROGRESS_REPOSITORY');
