// ==================== Repository Interface ====================
export interface IStoryProgressRepository {
  // Count completed, non-deleted story progress records for the given kids
  // (only counting progress on non-deleted stories)
  countCompletedForKids(kidIds: string[]): Promise<number>;
}

export const STORY_PROGRESS_REPOSITORY = Symbol('STORY_PROGRESS_REPOSITORY');
