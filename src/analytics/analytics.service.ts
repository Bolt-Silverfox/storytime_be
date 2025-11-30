import { Injectable } from '@nestjs/common';
import { PrismaClient, ActivityLog } from '@prisma/client';
import { CreateActivityLogDto, ActivityLogDto } from './analytics.dto';

const prisma = new PrismaClient();

@Injectable()
export class AnalyticsService {
  private toActivityLogDto(log: ActivityLog): ActivityLogDto {
    return {
      id: log.id,
      userId: log.userId ?? undefined,
      kidId: log.kidId ?? undefined,
      action: log.action,
      status: log.status, 
      deviceName: log.deviceName ?? undefined,
      deviceModel: log.deviceModel ?? undefined,
      os: log.os ?? undefined,
      ipAddress: log.ipAddress ?? undefined,
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
        status: dto.status,
        deviceName: dto.deviceName,
        deviceModel: dto.deviceModel,
        os: dto.os,
        ipAddress: dto.ipAddress,
        details: dto.details,
      },
    });
    return this.toActivityLogDto(log);
  }

  async logActivity(params: {
    userId?: string;
    kidId?: string;
    action: string;
    status: 'SUCCESS' | 'FAILED' | string;
    details?: string;
    ipAddress?: string;
    deviceName?: string;
    deviceModel?: string;
    os?: string;
  }): Promise<ActivityLogDto> {
    // Map params to DTO and call create()
    const dto: CreateActivityLogDto = {
      userId: params.userId,
      kidId: params.kidId,
      action: params.action,
      status: params.status,
      details: params.details,
      ipAddress: params.ipAddress,
      deviceName: params.deviceName,
      deviceModel: params.deviceModel,
      os: params.os,
    };
    return this.create(dto);
  }

  async getForUser(userId: string): Promise<ActivityLogDto[]> {
    const logs = await prisma.activityLog.findMany({ where: { userId } });
    return logs.map((l: any) => this.toActivityLogDto(l));
  }

  async getForKid(kidId: string): Promise<ActivityLogDto[]> {
    const logs = await prisma.activityLog.findMany({ where: { kidId } });
    return logs.map((l: any) => this.toActivityLogDto(l));
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
