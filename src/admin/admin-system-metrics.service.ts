import { Injectable, Logger, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ContentBreakdownDto,
  SystemHealthDto,
  ActivityLogDto,
} from './dto/admin-responses.dto';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  IAdminStoryRepository,
  ADMIN_STORY_REPOSITORY,
  IAdminContentRepository,
  ADMIN_CONTENT_REPOSITORY,
  IAdminActivityRepository,
  ADMIN_ACTIVITY_REPOSITORY,
  IAdminAnalyticsRepository,
  ADMIN_ANALYTICS_REPOSITORY,
} from './repositories';

@Injectable()
export class AdminSystemMetricsService {
  private readonly logger = new Logger(AdminSystemMetricsService.name);

  constructor(
    @Inject(ADMIN_STORY_REPOSITORY)
    private readonly storyRepo: IAdminStoryRepository,
    @Inject(ADMIN_CONTENT_REPOSITORY)
    private readonly contentRepo: IAdminContentRepository,
    @Inject(ADMIN_ACTIVITY_REPOSITORY)
    private readonly activityRepo: IAdminActivityRepository,
    @Inject(ADMIN_ANALYTICS_REPOSITORY)
    private readonly analyticsRepo: IAdminAnalyticsRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getContentBreakdown(): Promise<ContentBreakdownDto> {
    // Check cache first
    const cached = await this.cacheManager.get<ContentBreakdownDto>(
      CACHE_KEYS.CONTENT_BREAKDOWN,
    );
    if (cached) {
      this.logger.debug('Returning cached content breakdown');
      return cached;
    }

    const [languageStats, categoryStats, themeStats] = await Promise.all([
      this.storyRepo.groupByLanguage(),
      this.contentRepo.findCategoryBreakdown(),
      this.contentRepo.findThemeBreakdown(),
    ]);

    // Age group breakdown based on story age ranges
    const stories = await this.storyRepo.findAgeRanges();

    const ageGroups = stories.reduce(
      (acc, story) => {
        const range = `${story.ageMin}-${story.ageMax}`;
        acc[range] = (acc[range] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const result: ContentBreakdownDto = {
      byLanguage: languageStats.map((stat) => ({
        language: stat.language,
        count: stat._count,
      })),
      byAgeGroup: Object.entries(ageGroups).map(([ageRange, count]) => ({
        ageRange,
        count,
      })),
      byCategory: categoryStats.map((cat) => ({
        categoryName: cat.name,
        count: cat._count.stories,
      })),
      byTheme: themeStats.map((theme) => ({
        themeName: theme.name,
        count: theme._count.stories,
      })),
    };

    // Cache the result for 5 minutes
    await this.cacheManager.set(
      CACHE_KEYS.CONTENT_BREAKDOWN,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );

    return result;
  }

  async getSystemHealth(): Promise<SystemHealthDto> {
    const startTime = Date.now();

    try {
      await this.analyticsRepo.pingDatabase();
      const responseTime = Date.now() - startTime;

      const memUsage = process.memoryUsage();

      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        database: {
          connected: true,
          responseTime,
        },
        uptime: process.uptime(),
        memoryUsage: {
          used: memUsage.heapUsed,
          total: memUsage.heapTotal,
          percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        },
        timestamp: new Date(),
      };
    } catch {
      return {
        status: 'down',
        database: {
          connected: false,
        },
        uptime: process.uptime(),
        memoryUsage: {
          used: 0,
          total: 0,
          percentage: 0,
        },
        timestamp: new Date(),
      };
    }
  }

  async getSystemLogs(
    level?: string,
    limit: number = 100,
  ): Promise<ActivityLogDto[]> {
    const where: Prisma.ActivityLogWhereInput = { isDeleted: false };
    if (level) where.status = level;

    const logs = await this.activityRepo.findSystemLogs(where, limit);

    return logs.map((log) => ({
      id: log.id,
      userId: log.userId || undefined,
      kidId: log.kidId || undefined,
      action: log.action,
      status: log.status,
      deviceName: log.deviceName || undefined,
      deviceModel: log.deviceModel || undefined,
      os: log.os || undefined,
      ipAddress: log.ipAddress || undefined,
      details: log.details || undefined,
      createdAt: log.createdAt,
      isDeleted: log.isDeleted,
      deletedAt: log.deletedAt || undefined,
      user: log.user || undefined,
      kid: undefined, // Not included in this query
    }));
  }
}
