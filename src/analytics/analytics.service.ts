import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActivityLogDto, ActivityLogDto } from './dto/analytics.dto';
import { ActivityLog } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}  // Using PrismaService correctly

  // Map Prisma model to DTO
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

  // Create a new activity log
  async create(dto: CreateActivityLogDto): Promise<ActivityLogDto> {
    const log = await this.prisma.activityLog.create({
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

  // Added: logActivity method for controller compatibility
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
    const dto: CreateActivityLogDto = { ...params };
    return this.create(dto);
  }

  // Get logs for a specific user
  async getForUser(userId: string): Promise<ActivityLogDto[]> {
    const logs = await this.prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return logs.map((log) => this.toActivityLogDto(log));
  }

  // Get logs for a specific kid
  async getForKid(kidId: string): Promise<ActivityLogDto[]> {
    const logs = await this.prisma.activityLog.findMany({
      where: { kidId },
      orderBy: { createdAt: 'desc' },
    });
    return logs.map((log) => this.toActivityLogDto(log));
  }

  // Get log by ID
  async getById(id: string): Promise<ActivityLogDto | null> {
    const log = await this.prisma.activityLog.findUnique({ where: { id } });
    return log ? this.toActivityLogDto(log) : null;
  }

  // Get basic stats
  async getStats() {
    const [userCount, storyCount, kidCount, rewardCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.story.count(),
      this.prisma.kid.count(),
      this.prisma.reward.count(),
    ]);
    return { userCount, storyCount, kidCount, rewardCount };
  }
}
