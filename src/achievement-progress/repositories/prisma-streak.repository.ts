import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type {
  IStreakRepository,
  ActivityLogCreatedAt,
} from './streak.repository.interface';

@Injectable()
export class PrismaStreakRepository implements IStreakRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserActivityLogs(
    userId: string,
    fromDate: Date,
    actions: string[],
  ): Promise<ActivityLogCreatedAt[]> {
    return this.prisma.activityLog.findMany({
      where: {
        userId,
        createdAt: { gte: fromDate },
        action: { in: actions },
      },
      select: {
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findKidActivityLogs(
    kidId: string,
    fromDate: Date,
    actions: string[],
  ): Promise<ActivityLogCreatedAt[]> {
    return this.prisma.activityLog.findMany({
      where: {
        kidId,
        createdAt: { gte: fromDate },
        action: { in: actions },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLastUserActivity(
    userId: string,
  ): Promise<ActivityLogCreatedAt | null> {
    return this.prisma.activityLog.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
  }

  async findLastKidActivity(
    kidId: string,
  ): Promise<ActivityLogCreatedAt | null> {
    return this.prisma.activityLog.findFirst({
      where: { kidId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
  }
}
