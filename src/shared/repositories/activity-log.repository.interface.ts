import type { ActivityLog } from '@prisma/client';

// ==================== Repository Interface ====================
// DB access for the cross-cutting audit-trail listener.
export interface IActivityLogRepository {
  // Create an audit-trail activity log entry for a user action.
  createActivityLog(data: {
    userId: string;
    action: string;
    status: string;
    details: string;
  }): Promise<ActivityLog>;
}

export const ACTIVITY_LOG_REPOSITORY = Symbol('SHARED_ACTIVITY_LOG_REPOSITORY');
