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

export type AiCreditDuration =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly';
export type UserGrowthDuration = 'last_year' | 'last_month' | 'last_week';
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

  async getAiCreditAnalytics(
    duration?: AiCreditDuration,
  ): Promise<AiCreditAnalyticsDto> {
    const cacheKey = duration
      ? `${CACHE_KEYS.AI_CREDIT_ANALYTICS}:${duration}`
      : CACHE_KEYS.AI_CREDIT_ANALYTICS;
    const cached = await this.cacheManager.get<AiCreditAnalyticsDto>(cacheKey);
    if (cached) return cached;

    const result = await this.adminAnalyticsRepository.getAiCreditAnalytics();

    // Apply duration-based date filtering if specified
    if (duration && result.yearly) {
      const now = new Date();
      const cutoff = this.calculateDurationCutoff(now, duration);
      result.yearly = result.yearly.filter((entry) => {
        const entryDate = new Date(entry.month);
        return entryDate >= cutoff;
      });
    }

    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.DASHBOARD);
    return result;
  }

  private calculateDurationCutoff(
    now: Date,
    duration: AiCreditDuration | UserGrowthDuration,
  ): Date {
    const cutoff = new Date(now);
    switch (duration) {
      case 'daily':
        cutoff.setDate(cutoff.getDate() - 1);
        break;
      case 'weekly':
      case 'last_week':
        cutoff.setDate(cutoff.getDate() - 7);
        break;
      case 'monthly':
      case 'last_month':
        cutoff.setMonth(cutoff.getMonth() - 1);
        break;
      case 'quarterly':
        cutoff.setMonth(cutoff.getMonth() - 3);
        break;
      case 'yearly':
      case 'last_year':
        cutoff.setFullYear(cutoff.getFullYear() - 1);
        break;
    }
    return cutoff;
  }

  // =====================
  // USER GROWTH MONTHLY
  // =====================

  async getUserGrowthMonthly(
    duration?: UserGrowthDuration,
  ): Promise<{ data: UserGrowthMonthlyDto[] }> {
    const cacheKey = duration
      ? `${CACHE_KEYS.USER_GROWTH_MONTHLY}:${duration}`
      : CACHE_KEYS.USER_GROWTH_MONTHLY;
    const cached = await this.cacheManager.get<{
      data: UserGrowthMonthlyDto[];
    }>(cacheKey);
    if (cached) return cached;

    const result = await this.adminAnalyticsRepository.getUserGrowthMonthly();

    // TODO: Duration-based filtering for user growth
    // The UserGrowthMonthlyDto[] structure needs repository-level filtering
    // rather than in-memory filtering. Pass duration to repository when implemented.

    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.DASHBOARD);
    return result;
  }

  // =====================
  // EXPORT ANALYTICS DATA
  // =====================

  async exportAnalyticsData(
    type: 'users' | 'revenue' | 'subscriptions',
    format: 'csv' | 'json' = 'csv',
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: string; contentType: string }> {
    const dateRange: DateRangeDto = {};
    if (startDate) dateRange.startDate = startDate;
    if (endDate) dateRange.endDate = endDate;

    let rawData: any;

    switch (type) {
      case 'users': {
        const growth = await this.adminAnalyticsRepository.getUserGrowth(dateRange);
        rawData = growth;
        break;
      }
      case 'revenue': {
        const revenue =
          await this.adminAnalyticsRepository.getRevenueAnalytics(dateRange);
        rawData = revenue;
        break;
      }
      case 'subscriptions': {
        const subs =
          await this.adminAnalyticsRepository.getSubscriptionAnalytics(dateRange);
        rawData = subs;
        break;
      }
    }

    if (format === 'json') {
      return {
        data: JSON.stringify(rawData, null, 2),
        contentType: 'application/json',
      };
    }

    // CSV format
    const csvData = this.convertToCsv(rawData, type);
    return {
      data: csvData,
      contentType: 'text/csv',
    };
  }

  private convertToCsv(data: any, type: string): string {
    if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0]);
      const rows = data.map((row) =>
        headers.map((h) => this.sanitizeCsvValue(String(row[h] ?? ''))).join(','),
      );
      return [headers.join(','), ...rows].join('\n');
    }

    // For object-type data (revenue, subscriptions), flatten key metrics
    if (typeof data === 'object' && data !== null) {
      const entries = Object.entries(data);
      const lines: string[] = ['Section,Key,Value'];
      for (const [section, value] of entries) {
        if (Array.isArray(value)) {
          for (const item of value) {
            const itemEntries = Object.entries(item);
            for (const [k, v] of itemEntries) {
              lines.push(
                `${this.sanitizeCsvValue(section)},${this.sanitizeCsvValue(k)},${this.sanitizeCsvValue(String(v))}`,
              );
            }
          }
        } else {
          lines.push(
            `${this.sanitizeCsvValue(section)},,${this.sanitizeCsvValue(String(value))}`,
          );
        }
      }
      return lines.join('\n');
    }

    return '';
  }

  private sanitizeCsvValue(val: string): string {
    if (/^[=+\-@\t\r]/.test(val)) return `\t${val}`;
    return val;
  }
}
