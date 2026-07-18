import type { Prisma, ActivityLog } from '@prisma/client';

export type ActivityLogWithUser = Prisma.ActivityLogGetPayload<{
  include: {
    user: { select: { id: true; email: true; name: true } };
  };
}>;

export type GuestActivityRow = Prisma.ActivityLogGetPayload<{
  select: {
    id: true;
    action: true;
    status: true;
    details: true;
    ipAddress: true;
    deviceName: true;
    os: true;
    createdAt: true;
  };
}>;

export interface IAdminActivityRepository {
  count(where: Prisma.ActivityLogWhereInput): Promise<number>;

  // AI credit analytics — AI_GENERATION logs since a start date
  findAiGenerationLogs(startDate: Date): Promise<ActivityLog[]>;

  // System logs with user relation, newest first, limited
  findSystemLogs(
    where: Prisma.ActivityLogWhereInput,
    take: number,
  ): Promise<ActivityLogWithUser[]>;

  createLog(data: Prisma.ActivityLogCreateArgs['data']): Promise<ActivityLog>;

  // Guest activity feed (paginated, projected fields)
  findGuestActivity(params: {
    where: Prisma.ActivityLogWhereInput;
    take: number;
    skip: number;
  }): Promise<GuestActivityRow[]>;
}

export const ADMIN_ACTIVITY_REPOSITORY = Symbol('ADMIN_ACTIVITY_REPOSITORY');
