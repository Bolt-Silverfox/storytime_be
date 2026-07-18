// ==================== Repository Interface ====================
export interface IDailyChallengeAssignmentRepository {
  // Count completed challenge assignments for a kid within a date range (completedAt)
  countCompletedInRange(
    kidId: string,
    gte: Date,
    lt: Date,
  ): Promise<number>;

  // Count completed challenge assignments for a kid since a date (completedAt)
  countCompletedSince(kidId: string, gte: Date): Promise<number>;
}

export const DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY = Symbol(
  'DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY',
);
