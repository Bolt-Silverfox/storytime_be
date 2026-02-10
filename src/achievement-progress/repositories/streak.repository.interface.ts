// ==================== Types ====================
export interface ActivityLogCreatedAt {
  createdAt: Date;
}

// ==================== Repository Interface ====================
export interface IStreakRepository {
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
}

export const STREAK_REPOSITORY = Symbol('STREAK_REPOSITORY');
