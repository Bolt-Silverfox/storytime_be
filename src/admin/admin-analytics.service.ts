import { Injectable } from '@nestjs/common';
import {
  DashboardStatsDto,
  UserGrowthDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SystemHealthDto,
  SubscriptionAnalyticsDto,
  RevenueAnalyticsDto,
  ActivityLogDto,
  AiCreditAnalyticsDto,
  UserGrowthMonthlyDto,
} from './dto/admin-responses.dto';
import { DateRangeDto } from './dto/admin-filters.dto';
import { GuestStatsDto, GuestActivityFilterDto } from './dto/guest-stats.dto';
import { AdminDashboardMetricsService } from './admin-dashboard-metrics.service';
import { AdminRevenueAnalyticsService } from './admin-revenue-analytics.service';
import { AdminSystemMetricsService } from './admin-system-metrics.service';
import { AdminGuestAnalyticsService } from './admin-guest-analytics.service';

/**
 * Thin facade preserving the original AdminAnalyticsService public API.
 * Every method delegates verbatim to a focused analytics service so existing
 * injectors (admin controllers, AdminService) remain unchanged.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly dashboardMetricsService: AdminDashboardMetricsService,
    private readonly revenueAnalyticsService: AdminRevenueAnalyticsService,
    private readonly systemMetricsService: AdminSystemMetricsService,
    private readonly guestAnalyticsService: AdminGuestAnalyticsService,
  ) {}

  async getDashboardStats(): Promise<DashboardStatsDto> {
    return this.dashboardMetricsService.getDashboardStats();
  }

  async getUserGrowth(dateRange: DateRangeDto): Promise<UserGrowthDto[]> {
    return this.dashboardMetricsService.getUserGrowth(dateRange);
  }

  async getStoryStats(): Promise<StoryStatsDto> {
    return this.dashboardMetricsService.getStoryStats();
  }

  async getContentBreakdown(): Promise<ContentBreakdownDto> {
    return this.systemMetricsService.getContentBreakdown();
  }

  async getSystemHealth(): Promise<SystemHealthDto> {
    return this.systemMetricsService.getSystemHealth();
  }

  async getSubscriptionAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<SubscriptionAnalyticsDto> {
    return this.revenueAnalyticsService.getSubscriptionAnalytics(dateRange);
  }

  async getRevenueAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<RevenueAnalyticsDto> {
    return this.revenueAnalyticsService.getRevenueAnalytics(dateRange);
  }

  async getAiCreditAnalytics(
    duration:
      | 'yearly'
      | 'quarterly'
      | 'monthly'
      | 'weekly'
      | 'daily' = 'yearly',
  ): Promise<AiCreditAnalyticsDto> {
    return this.revenueAnalyticsService.getAiCreditAnalytics(duration);
  }

  async getUserGrowthMonthly(
    duration: 'last_year' | 'last_month' | 'last_week' = 'last_year',
  ): Promise<{ data: UserGrowthMonthlyDto }> {
    return this.dashboardMetricsService.getUserGrowthMonthly(duration);
  }

  async getSystemLogs(
    level?: string,
    limit: number = 100,
  ): Promise<ActivityLogDto[]> {
    return this.systemMetricsService.getSystemLogs(level, limit);
  }

  async getGuestStats(): Promise<GuestStatsDto> {
    return this.guestAnalyticsService.getGuestStats();
  }

  async getGuestActivity(filters: GuestActivityFilterDto) {
    return this.guestAnalyticsService.getGuestActivity(filters);
  }
}
