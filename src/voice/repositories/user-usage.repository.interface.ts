import type { UserUsage } from '@prisma/client';

export type UsageCounterField =
  | 'elevenLabsCount'
  | 'geminiStoryCount'
  | 'geminiImageCount';

// ==================== Repository Interface ====================
export interface IUserUsageRepository {
  // Atomically increment a usage counter with monthly rollover.
  // When the stored month differs from currentMonth, ALL counters are reset
  // to zero as part of the same transaction before incrementing.
  incrementCounterWithRollover(
    userId: string,
    currentMonth: string,
    field: UsageCounterField,
    amount: number,
  ): Promise<void>;

  // Atomically decrement elevenLabsCount, floored at zero, returning the
  // number of affected rows.
  decrementElevenLabsCreditsFloored(
    userId: string,
    credits: number,
  ): Promise<number>;

  // Ensure a usage record exists for the user (upsert with no-op update).
  upsertEnsureExists(userId: string, currentMonth: string): Promise<UserUsage>;

  // Compare-and-set lock of selectedSecondVoiceId when currently null.
  lockSecondVoiceIfNull(
    userId: string,
    voiceUuid: string,
  ): Promise<{ count: number }>;

  // Compare-and-set lock of elevenLabsTrialStoryId when currently null.
  lockTrialStoryIfNull(
    userId: string,
    storyId: string,
  ): Promise<{ count: number }>;

  // Find a user's usage record
  findByUserId(userId: string): Promise<UserUsage | null>;

  // Find only the selectedSecondVoiceId for a user's usage record
  findSelectedSecondVoiceId(
    userId: string,
  ): Promise<{ selectedSecondVoiceId: string | null } | null>;
}

export const USER_USAGE_REPOSITORY = Symbol('USER_USAGE_REPOSITORY');
