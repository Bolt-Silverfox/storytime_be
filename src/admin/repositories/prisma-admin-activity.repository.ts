import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, ActivityLog } from '@prisma/client';
import type {
  IAdminActivityRepository,
  ActivityLogWithUser,
  GuestActivityRow,
} from './admin-activity.repository.interface';

@Injectable()
export class PrismaAdminActivityRepository implements IAdminActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  count(where: Prisma.ActivityLogWhereInput): Promise<number> {
    return this.prisma.activityLog.count({ where });
  }

  findAiGenerationLogs(startDate: Date): Promise<ActivityLog[]> {
    return this.prisma.activityLog.findMany({
      where: {
        action: 'AI_GENERATION',
        createdAt: { gte: startDate },
      },
    });
  }

  findSystemLogs(
    where: Prisma.ActivityLogWhereInput,
    take: number,
  ): Promise<ActivityLogWithUser[]> {
    return this.prisma.activityLog.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  createLog(data: Prisma.ActivityLogCreateArgs['data']): Promise<ActivityLog> {
    return this.prisma.activityLog.create({ data });
  }

  findGuestActivity(params: {
    where: Prisma.ActivityLogWhereInput;
    take: number;
    skip: number;
  }): Promise<GuestActivityRow[]> {
    return this.prisma.activityLog.findMany({
      where: params.where,
      orderBy: { createdAt: 'desc' },
      take: params.take,
      skip: params.skip,
      select: {
        id: true,
        action: true,
        status: true,
        details: true,
        ipAddress: true,
        deviceName: true,
        os: true,
        createdAt: true,
      },
    });
  }
}
