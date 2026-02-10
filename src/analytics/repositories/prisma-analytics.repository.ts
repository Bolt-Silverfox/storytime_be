import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IAnalyticsRepository } from './analytics.repository.interface';
import type { ActivityLog } from '@prisma/client';

@Injectable()
export class PrismaAnalyticsRepository implements IAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createActivityLog(data: {
    userId?: string;
    kidId?: string;
    action: string;
    status: string;
    deviceName?: string;
    deviceModel?: string;
    os?: string;
    ipAddress?: string;
    details?: string;
  }): Promise<ActivityLog> {
    return this.prisma.activityLog.create({
      data,
    });
  }

  async findActivityLogsByUser(userId: string): Promise<ActivityLog[]> {
    return this.prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActivityLogsByKid(kidId: string): Promise<ActivityLog[]> {
    return this.prisma.activityLog.findMany({
      where: { kidId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActivityLogById(id: string): Promise<ActivityLog | null> {
    return this.prisma.activityLog.findUnique({ where: { id } });
  }

  async countUsers(): Promise<number> {
    return this.prisma.user.count();
  }

  async countStories(): Promise<number> {
    return this.prisma.story.count();
  }

  async countKids(): Promise<number> {
    return this.prisma.kid.count();
  }

  async countRewards(): Promise<number> {
    return this.prisma.reward.count();
  }
}
