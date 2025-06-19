import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateActivityLogDto, ActivityLogDto } from './analytics.dto';

const prisma = new PrismaClient();

@Injectable()
export class AnalyticsService {
  private toActivityLogDto(log: any): ActivityLogDto {
    return {
      id: log.id,
      userId: log.userId ?? undefined,
      kidId: log.kidId ?? undefined,
      action: log.action,
      details: log.details ?? undefined,
      createdAt: log.createdAt,
    };
  }

  async create(dto: CreateActivityLogDto): Promise<ActivityLogDto> {
    const log = await prisma.activityLog.create({
      data: {
        userId: dto.userId,
        kidId: dto.kidId,
        action: dto.action,
        details: dto.details,
      },
    });
    return this.toActivityLogDto(log);
  }

  async getForUser(userId: string): Promise<ActivityLogDto[]> {
    const logs = await prisma.activityLog.findMany({ where: { userId } });
    return logs.map((l) => this.toActivityLogDto(l));
  }

  async getForKid(kidId: string): Promise<ActivityLogDto[]> {
    const logs = await prisma.activityLog.findMany({ where: { kidId } });
    return logs.map((l) => this.toActivityLogDto(l));
  }

  async getById(id: string): Promise<ActivityLogDto | null> {
    const log = await prisma.activityLog.findUnique({ where: { id } });
    return log ? this.toActivityLogDto(log) : null;
  }

  async getStats() {
    const [userCount, storyCount, kidCount, rewardCount] = await Promise.all([
      prisma.user.count(),
      prisma.story.count(),
      prisma.kid.count(),
      prisma.reward.count(),
    ]);
    return { userCount, storyCount, kidCount, rewardCount };
  }
}
