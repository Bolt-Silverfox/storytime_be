import type { ActivityLog } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IAnalyticsRepository {
  // Create activity log
  createActivityLog(data: {
    userId?: string;
    kidId?: string;
    action: string;
    status: string;
    deviceName?: string;
    deviceModel?: string;
    os?: string;
    ipAddress?: string;
    details?: string;
  }): Promise<ActivityLog>;

  // Find activity logs by userId
  findActivityLogsByUser(userId: string): Promise<ActivityLog[]>;

  // Find activity logs by kidId
  findActivityLogsByKid(kidId: string): Promise<ActivityLog[]>;

  // Find activity log by id
  findActivityLogById(id: string): Promise<ActivityLog | null>;

  // Count users
  countUsers(): Promise<number>;

  // Count stories
  countStories(): Promise<number>;

  // Count kids
  countKids(): Promise<number>;

  // Count rewards
  countRewards(): Promise<number>;
}

export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');
