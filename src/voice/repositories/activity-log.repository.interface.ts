import type { ActivityLog } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IActivityLogRepository {
  // Create an activity log entry
  createActivityLog(data: {
    userId: string;
    action: string;
    status: string;
    details: string;
  }): Promise<ActivityLog>;
}

export const ACTIVITY_LOG_REPOSITORY = Symbol('ACTIVITY_LOG_REPOSITORY');
