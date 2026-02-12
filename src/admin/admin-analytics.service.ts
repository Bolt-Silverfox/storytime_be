import { Injectable, Logger, Inject } from '@nestjs/common';
import { ValidationException } from '@/shared/exceptions';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { Role } from '@prisma/client';
import {
  DashboardStatsDto,
  UserGrowthDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SystemHealthDto,
  SubscriptionAnalyticsDto,
  RevenueAnalyticsDto,
  AiCreditAnalyticsDto,
  UserGrowthMonthlyDto,
} from './dto/admin-responses.dto';
import { DateRangeDto } from './dto/admin-filters.dto';
import { DateUtil } from '@/shared/utils/date.util';
import { Timeframe, TrendLabel } from '@/shared/constants/time.constants';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';
import { DashboardUtil } from './utils/dashboard.util';
import {
  IAdminAnalyticsRepository,
  ADMIN_ANALYTICS_REPOSITORY,
} from './repositories';

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(
    @Inject(ADMIN_ANALYTICS_REPOSITORY)
    private readonly adminAnalyticsRepository: IAdminAnalyticsRepository,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // =====================
  // DASHBOARD STATISTICS
  // =====================

  async getDashboardStats(): Promise<DashboardStatsDto> {
    // Check cache first
    const cached = await this.cacheManager.get<DashboardStatsDto>(
      CACHE_KEYS.DASHBOARD_STATS,
    );
    if (cached) {
      this.logger.debug('Returning cached dashboard stats');
      return cached;
    }

    const result = await this.adminAnalyticsRepository.getDashboardStats();

    // Cache the result for 5 minutes
    await this.cacheManager.set(
      CACHE_KEYS.DASHBOARD_STATS,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );
    this.logger.debug('Dashboard stats cached for 5 minutes');

    return result;
  }

  // =====================
  // USER GROWTH
  // =====================

  async getUserGrowth(dateRange: DateRangeDto): Promise<UserGrowthDto[]> {
    const cacheKey = CACHE_KEYS.USER_GROWTH(JSON.stringify(dateRange));
    const cached = await this.cacheManager.get<UserGrowthDto[]>(cacheKey);
    if (cached) return cached;

    const result = await this.adminAnalyticsRepository.getUserGrowth(dateRange);
    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.DASHBOARD);
    return result;
  }

  // =====================
  // STORY STATS
  // =====================

  async getStoryStats(): Promise<StoryStatsDto> {
    const cached = await this.cacheManager.get<StoryStatsDto>(
      CACHE_KEYS.STORY_STATS,
    );
    if (cached) {
      this.logger.debug('Returning cached story stats');
      return cached;
    }

    const result = await this.adminAnalyticsRepository.getStoryStats();

    await this.cacheManager.set(
      CACHE_KEYS.STORY_STATS,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );

    return result;
  }

  // =====================
  // CONTENT BREAKDOWN
  // =====================

  async getContentBreakdown(): Promise<ContentBreakdownDto> {
    const cached = await this.cacheManager.get<ContentBreakdownDto>(
      CACHE_KEYS.CONTENT_BREAKDOWN,
    );
    if (cached) {
      this.logger.debug('Returning cached content breakdown');
      return cached;
    }

    const result = await this.adminAnalyticsRepository.getContentBreakdown();

    await this.cacheManager.set(
      CACHE_KEYS.CONTENT_BREAKDOWN,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );

    return result;
  }

  // =====================
  // SYSTEM HEALTH
  // =====================

  async getSystemHealth(): Promise<SystemHealthDto> {
    const startTime = Date.now();

    try {
      // Still need a raw check for health, but could move to repository
      const health = await this.adminAnalyticsRepository.getDashboardStats(); // Mock check
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

  // =====================
  // SUBSCRIPTION ANALYTICS
  // =====================

  async getSubscriptionAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<SubscriptionAnalyticsDto> {
    const cacheKey = CACHE_KEYS.SUBSCRIPTION_ANALYTICS(
      JSON.stringify(dateRange || {}),
    );
    const cached =
      await this.cacheManager.get<SubscriptionAnalyticsDto>(cacheKey);
    if (cached) return cached;

    const result =
      await this.adminAnalyticsRepository.getSubscriptionAnalytics(dateRange);
    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.DASHBOARD);
    return result;
  }

  // =====================
  // REVENUE ANALYTICS
  // =====================

  async getRevenueAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<RevenueAnalyticsDto> {
    const cacheKey = CACHE_KEYS.REVENUE_ANALYTICS(
      JSON.stringify(dateRange || {}),
    );
    const cached = await this.cacheManager.get<RevenueAnalyticsDto>(cacheKey);
    if (cached) return cached;

    const result =
      await this.adminAnalyticsRepository.getRevenueAnalytics(dateRange);
    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.DASHBOARD);
    return result;
  }

  // =====================
  // AI CREDIT ANALYTICS
  // =====================

  async getAiCreditAnalytics(): Promise<AiCreditAnalyticsDto> {
    const cached = await this.cacheManager.get<AiCreditAnalyticsDto>(
      CACHE_KEYS.AI_CREDIT_ANALYTICS,
    );
    if (cached) return cached;

    const result = await this.adminAnalyticsRepository.getAiCreditAnalytics();
    await this.cacheManager.set(
      CACHE_KEYS.AI_CREDIT_ANALYTICS,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );
    return result;
  }

  // =====================
  // USER GROWTH MONTHLY
  // =====================

  async getUserGrowthMonthly(): Promise<{ data: UserGrowthMonthlyDto[] }> {
    const cached = await this.cacheManager.get<{
      data: UserGrowthMonthlyDto[];
    }>(CACHE_KEYS.USER_GROWTH_MONTHLY);
    if (cached) return cached;

    const result = await this.adminAnalyticsRepository.getUserGrowthMonthly();
    await this.cacheManager.set(
      CACHE_KEYS.USER_GROWTH_MONTHLY,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );
    return result;
  }
}
