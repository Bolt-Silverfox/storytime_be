import { Injectable, Inject } from '@nestjs/common';
import { CreateActivityLogDto, ActivityLogDto } from './dto/analytics.dto';
import { ActivityLog } from '@prisma/client';
import { IAnalyticsRepository, ANALYTICS_REPOSITORY } from './repositories';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_REPOSITORY)
    private readonly analyticsRepository: IAnalyticsRepository,
  ) {}

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
    const log = await this.analyticsRepository.createActivityLog({
      userId: dto.userId,
      kidId: dto.kidId,
      action: dto.action,
      status: dto.status,
      deviceName: dto.deviceName,
      deviceModel: dto.deviceModel,
      os: dto.os,
      ipAddress: dto.ipAddress,
      details: dto.details,
    });
    return this.toActivityLogDto(log);
  }

  // Added: logActivity method for controller compatibility
  async logActivity(params: {
    userId?: string;
    kidId?: string;
    action: string;
    status: string;
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
    const logs = await this.analyticsRepository.findActivityLogsByUser(userId);
    return logs.map((log) => this.toActivityLogDto(log));
  }

  // Get logs for a specific kid
  async getForKid(kidId: string): Promise<ActivityLogDto[]> {
    const logs = await this.analyticsRepository.findActivityLogsByKid(kidId);
    return logs.map((log) => this.toActivityLogDto(log));
  }

  // Get log by ID
  async getById(id: string): Promise<ActivityLogDto | null> {
    const log = await this.analyticsRepository.findActivityLogById(id);
    return log ? this.toActivityLogDto(log) : null;
  }

  // Get basic stats
  async getStats() {
    const [userCount, storyCount, kidCount, rewardCount] = await Promise.all([
      this.analyticsRepository.countUsers(),
      this.analyticsRepository.countStories(),
      this.analyticsRepository.countKids(),
      this.analyticsRepository.countRewards(),
    ]);
    return { userCount, storyCount, kidCount, rewardCount };
  }
}
