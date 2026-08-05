import type { ActivityLog, Prisma } from '@prisma/client';

// ==================== Types ====================
export interface ActivityLogCreatedAt {
  createdAt: Date;
}

// ==================== Repository Interface ====================
export interface IStreakRepository {
  // Create an activity log entry
  createActivityLog(
    data: Prisma.ActivityLogUncheckedCreateInput,
  ): Promise<ActivityLog>;

  // Find activity logs for a user within a date range with specific actions
  findUserActivityLogs(
    userId: string,
    fromDate: Date,
    actions: string[],
  ): Promise<ActivityLogCreatedAt[]>;

  // Find activity logs for a kid within a date range with specific actions
  findKidActivityLogs(
    kidId: string,
    fromDate: Date,
    actions: string[],
  ): Promise<ActivityLogCreatedAt[]>;

  // Find the most recent activity log for a user
  findLastUserActivity(userId: string): Promise<ActivityLogCreatedAt | null>;

  // Find the most recent activity log for a kid
  findLastKidActivity(kidId: string): Promise<ActivityLogCreatedAt | null>;

  // Whether an activity log already records `action` for this kid and question.
  // Used as the durable marker that badge progress was actually recorded, so a
  // run that died after persisting the answer can self-heal on a later attempt.
  hasKidActivityForQuestion(
    kidId: string,
    action: string,
    questionId: string,
  ): Promise<boolean>;
}

export const STREAK_REPOSITORY = Symbol('STREAK_REPOSITORY');
