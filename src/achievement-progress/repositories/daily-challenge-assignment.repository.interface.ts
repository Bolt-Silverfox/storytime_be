import type { DailyChallengeAssignment } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IDailyChallengeAssignmentRepository {
  // Count completed daily challenge assignments for the given kids
  countCompletedForKids(kidIds: string[]): Promise<number>;

  // Mark matching daily challenge assignments as completed
  // (updateMany since there's no unique constraint)
  markCompleted(kidId: string, challengeId: string): Promise<{ count: number }>;

  // Find the first daily challenge assignment for a kid and challenge
  findFirstByKidAndChallenge(
    kidId: string,
    challengeId: string,
  ): Promise<DailyChallengeAssignment | null>;
}

export const DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY = Symbol(
  'DAILY_CHALLENGE_ASSIGNMENT_REPOSITORY',
);
