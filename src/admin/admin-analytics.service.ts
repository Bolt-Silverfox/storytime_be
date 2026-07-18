import {
  Injectable,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Role, Prisma } from '@prisma/client';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
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
import { DateUtil } from '@/shared/utils/date.util';
import { Timeframe, TrendLabel } from '@/shared/constants/time.constants';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';
import { DashboardUtil } from './utils/dashboard.util';
import { GuestStatsDto, GuestActivityFilterDto } from './dto/guest-stats.dto';
import {
  GUEST_SESSION_CREATED,
  GUEST_STORY_ACCESSED,
  GUEST_QUOTA_EXHAUSTED,
} from '@/guest/guest-activity.constants';
import {
  IAdminUserRepository,
  ADMIN_USER_REPOSITORY,
  IAdminSubscriptionRepository,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  IAdminPaymentRepository,
  ADMIN_PAYMENT_REPOSITORY,
  IAdminStoryRepository,
  ADMIN_STORY_REPOSITORY,
  IAdminContentRepository,
  ADMIN_CONTENT_REPOSITORY,
  IAdminEngagementRepository,
  ADMIN_ENGAGEMENT_REPOSITORY,
  IAdminActivityRepository,
  ADMIN_ACTIVITY_REPOSITORY,
  IAdminAnalyticsRepository,
  ADMIN_ANALYTICS_REPOSITORY,
} from './repositories';

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly userRepo: IAdminUserRepository,
    @Inject(ADMIN_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepo: IAdminSubscriptionRepository,
    @Inject(ADMIN_PAYMENT_REPOSITORY)
    private readonly paymentRepo: IAdminPaymentRepository,
    @Inject(ADMIN_STORY_REPOSITORY)
    private readonly storyRepo: IAdminStoryRepository,
    @Inject(ADMIN_CONTENT_REPOSITORY)
    private readonly contentRepo: IAdminContentRepository,
    @Inject(ADMIN_ENGAGEMENT_REPOSITORY)
    private readonly engagementRepo: IAdminEngagementRepository,
    @Inject(ADMIN_ACTIVITY_REPOSITORY)
    private readonly activityRepo: IAdminActivityRepository,
    @Inject(ADMIN_ANALYTICS_REPOSITORY)
    private readonly analyticsRepo: IAdminAnalyticsRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getDashboardStats(): Promise<DashboardStatsDto> {
    // Check cache first
    const cached = await this.cacheManager.get<DashboardStatsDto>(
      CACHE_KEYS.DASHBOARD_STATS,
    );
    if (cached) {
      this.logger.debug('Returning cached dashboard stats');
      return cached;
    }

    const now = new Date();

    // Timeframes
    const range24h = DateUtil.getRange(Timeframe.LAST_24_HOURS, now);
    const range7d = DateUtil.getRange(Timeframe.LAST_7_DAYS, now);
    const range30d = DateUtil.getRange(Timeframe.LAST_30_DAYS, now);
    const rangeToday = DateUtil.getRange(Timeframe.TODAY, now);
    const rangeThisMonth = DateUtil.getRange(Timeframe.THIS_MONTH, now);
    const rangeLastMonth = DateUtil.getRange(Timeframe.LAST_MONTH, now);

    // Comparative Periods
    const prevRange24h = DateUtil.getPreviousPeriod(range24h);
    const prevRange7d = DateUtil.getPreviousPeriod(range7d);
    const prevRange30d = DateUtil.getPreviousPeriod(range30d);

    const rangeYesterday = DateUtil.getRange(Timeframe.YESTERDAY, now); // For "New Users Today" comparison

    // Helper to count users created between dates
    const countBetween = (start: Date, end: Date): Promise<number> =>
      this.userRepo.count({
        createdAt: { gte: start, lte: end },
        isDeleted: false,
      });

    // 1. Fetch Current Metrics
    const [
      totalParents,
      totalKids,
      totalAdmins,
      totalStories,
      totalCategories,
      totalThemes,
      activeUsers24h,
      activeUsers7d,
      activeUsers30d,
      newUsersToday,
      newUsersThisMonth,
      totalStoryProgress,
      totalFavorites,
      totalSubscriptions,
      activeSubscriptionsCount,
      totalRevenueResult,
    ] = await Promise.all([
      this.userRepo.count({ role: Role.parent, isDeleted: false }),
      this.engagementRepo.countKids({ isDeleted: false }),
      this.userRepo.count({ role: Role.admin, isDeleted: false }),
      this.storyRepo.countStories({ isDeleted: false }),
      this.contentRepo.countCategories(),
      this.contentRepo.countThemes(),

      // Active Users
      this.userRepo.count({
        updatedAt: { gte: range24h.start },
        isDeleted: false,
      }),
      this.userRepo.count({
        updatedAt: { gte: range7d.start },
        isDeleted: false,
      }),
      this.userRepo.count({
        updatedAt: { gte: range30d.start },
        isDeleted: false,
      }),

      // New Users
      countBetween(rangeToday.start, rangeToday.end),
      countBetween(rangeThisMonth.start, rangeThisMonth.end),

      // Engagement
      this.engagementRepo.countStoryProgress(), // Total views (cumulative)
      this.engagementRepo.countFavorites(), // Total favorites (cumulative)

      // Subs
      this.subscriptionRepo.count({}),
      this.subscriptionRepo.count({
        status: 'active',
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      }),

      // Revenue
      this.paymentRepo.sumRevenue({ status: 'success', deletedAt: null }),
    ]);

    const totalUsersCount = await this.userRepo.count({ isDeleted: false });
    const totalRevenue = totalRevenueResult._sum.amount || 0;

    // 2. Fetch Previous Period Metrics for Trends
    // Trends for "Total" metrics (Growth vs Last Month)
    // We compare [Current Total] vs [Total at end of Last Month]
    const lastMonthEnd = rangeLastMonth.end;

    const [
      prevTotalUsers,
      prevTotalParents,
      prevTotalKids,
      prevTotalAdmins,
      prevTotalStories,
      prevTotalCategories,
      prevTotalThemes,
      prevTotalStoryProgress,
      prevTotalFavorites,
      prevTotalSubscriptions,
      prevActiveSubscriptionsCount,
      prevTotalRevenueResult,
    ] = await Promise.all([
      this.userRepo.count({
        createdAt: { lte: lastMonthEnd },
        isDeleted: false,
      }),
      this.userRepo.count({
        role: Role.parent,
        createdAt: { lte: lastMonthEnd },
        isDeleted: false,
      }),
      this.engagementRepo.countKids({
        createdAt: { lte: lastMonthEnd },
        isDeleted: false,
      }),
      this.userRepo.count({
        role: Role.admin,
        createdAt: { lte: lastMonthEnd },
        isDeleted: false,
      }),
      this.storyRepo.countStories({
        createdAt: { lte: lastMonthEnd },
        isDeleted: false,
      }),
      this.contentRepo.countCategories(),
      this.contentRepo.countThemes(),

      this.engagementRepo.countStoryProgress({
        lastAccessed: { lte: lastMonthEnd },
      }),
      this.engagementRepo.countFavorites({
        createdAt: { lte: lastMonthEnd },
      }),
      this.subscriptionRepo.count({
        startedAt: { lte: lastMonthEnd },
      }),

      // Active Subs History (Approximate)
      this.subscriptionRepo.count({
        status: 'active',
        startedAt: { lte: lastMonthEnd },
        OR: [{ endsAt: null }, { endsAt: { gt: lastMonthEnd } }],
      }),

      this.paymentRepo.sumRevenue({
        status: 'success',
        deletedAt: null,
        createdAt: { lte: lastMonthEnd },
      }),
    ]);

    const prevTotalRevenue = prevTotalRevenueResult._sum.amount || 0;

    // Trends for "Active" & "New" metrics (Time shifting)
    const [
      prevActiveUsers24h,
      prevActiveUsers7d,
      prevActiveUsers30d,
      _unused, // eslint-disable-line @typescript-eslint/no-unused-vars
      prevNewUsersThisMonth,
    ] = await Promise.all([
      this.userRepo.count({
        updatedAt: { gte: prevRange24h.start, lt: prevRange24h.end },
        isDeleted: false,
      }),
      this.userRepo.count({
        updatedAt: { gte: prevRange7d.start, lt: prevRange7d.end },
        isDeleted: false,
      }),
      this.userRepo.count({
        updatedAt: { gte: prevRange30d.start, lt: prevRange30d.end },
        isDeleted: false,
      }),

      // New Users Today vs Yesterday
      countBetween(rangeYesterday.start, rangeYesterday.end),
      // New Users This Month vs Last Month
      countBetween(rangeLastMonth.start, rangeLastMonth.end),
    ]);

    // Subscription breakdown
    const subscriptionPlans =
      await this.subscriptionRepo.groupByActivePlan(now);

    const avgSessionTime = 0; // Placeholder
    const paidUsers = activeSubscriptionsCount;
    const unpaidUsers = totalUsersCount - paidUsers;
    const prevPaidUsers = prevActiveSubscriptionsCount;
    const prevUnpaidUsers = prevTotalUsers - prevPaidUsers;

    const result: DashboardStatsDto = {
      totalUsers: totalUsersCount,
      totalParents,
      totalKids,
      totalAdmins,
      totalStories,
      totalCategories,
      totalThemes,
      activeUsers24h,
      activeUsers7d,
      newUsersToday,
      newUsersThisWeek: 0,
      newUsersThisMonth,
      totalStoryViews: totalStoryProgress,
      totalFavorites,
      averageSessionTime: Math.round(avgSessionTime),
      paidUsers,
      unpaidUsers,
      totalSubscriptions,
      activeSubscriptions: activeSubscriptionsCount,
      subscriptionPlans: subscriptionPlans.map((p) => ({
        plan: p.plan,
        count: p._count,
      })),
      totalRevenue: Number(totalRevenue.toFixed(2)),
      conversionRate:
        totalUsersCount > 0
          ? Number(((paidUsers / totalUsersCount) * 100).toFixed(2))
          : 0,

      performanceMetrics: {
        // User Metrics
        totalUsers: DashboardUtil.calculateTrend(
          totalUsersCount,
          prevTotalUsers,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalParents: DashboardUtil.calculateTrend(
          totalParents,
          prevTotalParents,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalKids: DashboardUtil.calculateTrend(
          totalKids,
          prevTotalKids,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalAdmins: DashboardUtil.calculateTrend(
          totalAdmins,
          prevTotalAdmins,
          TrendLabel.VS_LAST_MONTH,
        ),

        // Engagement
        activeUsers24h: DashboardUtil.calculateTrend(
          activeUsers24h,
          prevActiveUsers24h,
          TrendLabel.VS_PREV_24H,
        ),
        activeUsers7d: DashboardUtil.calculateTrend(
          activeUsers7d,
          prevActiveUsers7d,
          TrendLabel.VS_PREV_7D,
        ),
        activeUsers30d: DashboardUtil.calculateTrend(
          activeUsers30d,
          prevActiveUsers30d,
          TrendLabel.VS_PREV_30D,
        ),
        newUsers: DashboardUtil.calculateTrend(
          newUsersThisMonth,
          prevNewUsersThisMonth,
          TrendLabel.VS_LAST_MONTH,
        ), // Monthly Trend

        averageSessionTime: DashboardUtil.calculateTrend(
          avgSessionTime,
          0,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalStoryViews: DashboardUtil.calculateTrend(
          totalStoryProgress,
          prevTotalStoryProgress,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalFavorites: DashboardUtil.calculateTrend(
          totalFavorites,
          prevTotalFavorites,
          TrendLabel.VS_LAST_MONTH,
        ),

        // Content
        totalStories: DashboardUtil.calculateTrend(
          totalStories,
          prevTotalStories,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalCategories: DashboardUtil.calculateTrend(
          totalCategories,
          prevTotalCategories,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalThemes: DashboardUtil.calculateTrend(
          totalThemes,
          prevTotalThemes,
          TrendLabel.VS_LAST_MONTH,
        ),

        // Revenue & Subs
        totalRevenue: DashboardUtil.calculateTrend(
          totalRevenue,
          prevTotalRevenue,
          TrendLabel.VS_LAST_MONTH,
        ),
        totalSubscriptions: DashboardUtil.calculateTrend(
          totalSubscriptions,
          prevTotalSubscriptions,
          TrendLabel.VS_LAST_MONTH,
        ),
        activeSubscriptions: DashboardUtil.calculateTrend(
          activeSubscriptionsCount,
          prevActiveSubscriptionsCount,
          TrendLabel.VS_LAST_MONTH,
        ),
        paidUsers: DashboardUtil.calculateTrend(
          paidUsers,
          prevPaidUsers,
          TrendLabel.VS_LAST_MONTH,
        ),
        unpaidUsers: DashboardUtil.calculateTrend(
          unpaidUsers,
          prevUnpaidUsers,
          TrendLabel.VS_LAST_MONTH,
        ),
        conversionRate: DashboardUtil.calculateTrend(
          totalUsersCount > 0
            ? Number(((paidUsers / totalUsersCount) * 100).toFixed(2))
            : 0,
          prevTotalUsers > 0
            ? Number(((prevPaidUsers / prevTotalUsers) * 100).toFixed(2))
            : 0,
          TrendLabel.VS_LAST_MONTH,
        ),
      },
    };

    // Cache the result for 5 minutes
    await this.cacheManager.set(
      CACHE_KEYS.DASHBOARD_STATS,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );
    this.logger.debug('Dashboard stats cached for 5 minutes');

    return result;
  }

  async getUserGrowth(dateRange: DateRangeDto): Promise<UserGrowthDto[]> {
    const startDate = dateRange.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    const users = await this.userRepo.findManyWithSubscription({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        isDeleted: false,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const groupedByDate = users.reduce(
      (acc, user) => {
        const date = user.createdAt.toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { total: 0, paid: 0 };
        }
        acc[date].total += 1;
        if (user.subscription?.status === 'active') {
          acc[date].paid += 1;
        }
        return acc;
      },
      {} as Record<string, { total: number; paid: number }>,
    );

    let totalUsers = await this.userRepo.count({
      createdAt: { lt: startDate },
      isDeleted: false,
    });

    let totalPaidUsers = await this.userRepo.count({
      createdAt: { lt: startDate },
      isDeleted: false,
      subscription: {
        status: 'active',
      },
    });

    return Object.entries(groupedByDate).map(([date, counts]) => {
      totalUsers += counts.total;
      totalPaidUsers += counts.paid;
      return {
        date,
        newUsers: counts.total,
        paidUsers: counts.paid,
        totalUsers,
        totalPaidUsers,
      };
    });
  }

  async getStoryStats(): Promise<StoryStatsDto> {
    // Check cache first
    const cached = await this.cacheManager.get<StoryStatsDto>(
      CACHE_KEYS.STORY_STATS,
    );
    if (cached) {
      this.logger.debug('Returning cached story stats');
      return cached;
    }

    const [
      totalStories,
      publishedStories,
      aiGeneratedStories,
      recommendedStories,
      deletedStories,
      totalViews,
      totalFavorites,
    ] = await Promise.all([
      this.storyRepo.countStories({ isDeleted: false }),
      this.storyRepo.countStories({ isDeleted: false }),
      this.storyRepo.countStories({
        aiGenerated: true,
        isDeleted: false,
      }),
      this.storyRepo.countStories({
        recommended: true,
        isDeleted: false,
      }),
      this.storyRepo.countStories({ isDeleted: true }),
      this.engagementRepo.countStoryProgress(),
      this.engagementRepo.countFavorites(),
    ]);

    const result: StoryStatsDto = {
      totalStories,
      publishedStories,
      draftStories: 0,
      aiGeneratedStories,
      recommendedStories,
      deletedStories,
      totalViews,
      totalFavorites,
    };

    // Cache the result for 5 minutes
    await this.cacheManager.set(
      CACHE_KEYS.STORY_STATS,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );

    return result;
  }

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

  async getSubscriptionAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<SubscriptionAnalyticsDto> {
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    const [subscriptions, revenue, planBreakdown] = await Promise.all([
      // Get subscription growth
      this.subscriptionRepo.groupByStartedAt(startDate, endDate),
      // Get revenue growth
      this.paymentRepo.groupRevenueByCreatedAt(startDate, endDate),
      // Get subscription plan breakdown
      this.subscriptionRepo.groupByActivePlan(new Date()),
    ]);

    // Calculate churn rate
    const churnRate = await this.calculateChurnRate(startDate, endDate);

    return {
      subscriptionGrowth: subscriptions.map((sub) => ({
        date: sub.startedAt.toISOString().split('T')[0],
        count: sub._count,
      })),
      revenueGrowth: revenue.map((rev) => ({
        date: rev.createdAt.toISOString().split('T')[0],
        amount: rev._sum.amount || 0,
      })),
      planBreakdown: planBreakdown.map((plan) => ({
        plan: plan.plan,
        count: plan._count,
      })),
      churnRate,
    };
  }

  private async calculateChurnRate(
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const totalSubscriptionsAtStart = await this.subscriptionRepo.count({
      startedAt: { lt: startDate },
      status: 'active',
    });

    const churnedSubscriptions = await this.subscriptionRepo.count({
      OR: [
        { status: 'cancelled' },
        {
          status: 'active',
          endsAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      ],
    });

    return totalSubscriptionsAtStart > 0
      ? (churnedSubscriptions / totalSubscriptionsAtStart) * 100
      : 0;
  }

  async getRevenueAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<RevenueAnalyticsDto> {
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    try {
      const dailyRevenue =
        await this.paymentRepo.groupRevenueByCreatedAtOrdered(
          startDate,
          endDate,
        );

      // For monthly and yearly revenue
      const allTransactions = await this.paymentRepo.findSuccessfulInRange(
        startDate,
        endDate,
      );

      // Group by month
      const monthlyRevenueMap = new Map<string, number>();
      // Group by year
      const yearlyRevenueMap = new Map<string, number>();

      allTransactions.forEach((transaction) => {
        const date = new Date(transaction.createdAt);
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        const yearKey = date.getFullYear().toString();

        monthlyRevenueMap.set(
          monthKey,
          (monthlyRevenueMap.get(monthKey) || 0) + transaction.amount,
        );
        yearlyRevenueMap.set(
          yearKey,
          (yearlyRevenueMap.get(yearKey) || 0) + transaction.amount,
        );
      });

      const monthlyRevenue = Array.from(monthlyRevenueMap.entries()).map(
        ([month, total]) => ({
          month,
          total_amount: total,
        }),
      );

      const yearlyRevenue = Array.from(yearlyRevenueMap.entries()).map(
        ([year, total]) => ({
          year,
          total_amount: total,
        }),
      );

      // Get top plans
      const subscriptionsWithRevenue =
        await this.subscriptionRepo.findActiveWithUserRevenue();

      const planRevenueMap = new Map<
        string,
        { subscription_count: number; total_revenue: number }
      >();

      subscriptionsWithRevenue.forEach((sub) => {
        const current = planRevenueMap.get(sub.plan) || {
          subscription_count: 0,
          total_revenue: 0,
        };
        const userRevenue = sub.user.paymentTransactions.reduce(
          (sum, t) => sum + t.amount,
          0,
        );

        planRevenueMap.set(sub.plan, {
          subscription_count: current.subscription_count + 1,
          total_revenue: current.total_revenue + userRevenue,
        });
      });

      const topPlans = Array.from(planRevenueMap.entries())
        .map(([plan, stats]) => ({
          plan,
          subscription_count: stats.subscription_count,
          total_revenue: stats.total_revenue,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 10);

      return {
        dailyRevenue: dailyRevenue.map((day) => ({
          date: day.createdAt.toISOString().split('T')[0],
          amount: day._sum.amount || 0,
        })),
        monthlyRevenue,
        yearlyRevenue,
        topPlans,
      };
    } catch (error) {
      this.logger.error('Error getting revenue analytics:', error);
      throw new BadRequestException('Failed to get revenue analytics');
    }
  }

  async getAiCreditAnalytics(
    duration:
      | 'yearly'
      | 'quarterly'
      | 'monthly'
      | 'weekly'
      | 'daily' = 'yearly',
  ): Promise<AiCreditAnalyticsDto> {
    const now = new Date();
    let startDate: Date;
    let labels: string[];
    let getKey: (d: Date) => string;

    switch (duration) {
      case 'daily': {
        // Last 24 hours, grouped by hour (aligned to hour boundary)
        const hourAligned = new Date(now);
        hourAligned.setMinutes(0, 0, 0);
        startDate = new Date(hourAligned.getTime() - 24 * 60 * 60 * 1000);
        labels = [];
        for (let i = 0; i < 24; i++) {
          const h = new Date(startDate.getTime() + i * 60 * 60 * 1000);
          labels.push(
            h.toLocaleString('en-US', { hour: '2-digit', hour12: true }),
          );
        }
        getKey = (d: Date) =>
          d.toLocaleString('en-US', { hour: '2-digit', hour12: true });
        break;
      }
      case 'weekly': {
        // Last 7 days, grouped by day (aligned to start of day)
        const weekStart = new Date(now);
        weekStart.setHours(0, 0, 0, 0);
        startDate = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        labels = [];
        for (let i = 0; i < 7; i++) {
          const day = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
          labels.push(
            day.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }),
          );
        }
        getKey = (d: Date) =>
          d.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
        break;
      }
      case 'monthly': {
        // Last 30 days, grouped by day (aligned to start of day)
        const monthStart = new Date(now);
        monthStart.setHours(0, 0, 0, 0);
        startDate = new Date(monthStart.getTime() - 30 * 24 * 60 * 60 * 1000);
        labels = [];
        for (let i = 0; i < 30; i++) {
          const day = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
          labels.push(
            day.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
          );
        }
        getKey = (d: Date) =>
          d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
        break;
      }
      case 'quarterly': {
        // Current year grouped by quarter
        startDate = new Date(now.getFullYear(), 0, 1);
        labels = ['Q1', 'Q2', 'Q3', 'Q4'];
        getKey = (d: Date) => {
          const q = Math.floor(d.getMonth() / 3) + 1;
          return `Q${q}`;
        };
        break;
      }
      case 'yearly':
      default: {
        // 12 months of current year
        startDate = new Date(now.getFullYear(), 0, 1);
        labels = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];
        getKey = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
        break;
      }
    }

    const logs = await this.activityRepo.findAiGenerationLogs(startDate);

    // Initialize map
    const dataMap = new Map<
      string,
      { elevenLabs: number; gemini: number; total: number }
    >();
    labels.forEach((label) => {
      dataMap.set(label, { elevenLabs: 0, gemini: 0, total: 0 });
    });

    logs.forEach((log) => {
      const key = getKey(log.createdAt);
      if (!dataMap.has(key)) return;

      let credits = 1;
      let provider = '';
      try {
        const details = JSON.parse(log.details || '{}');
        credits = details.credits || 1;
        provider = details.provider || '';
      } catch {
        // Fallback
      }

      const entry = dataMap.get(key)!;
      if (provider === String(AiProviders.ElevenLabs))
        entry.elevenLabs += credits;
      if (provider === String(AiProviders.Gemini)) entry.gemini += credits;
      entry.total += credits;
    });

    const yearly = labels.map((label) => ({
      label,
      month: label,
      ...dataMap.get(label)!,
    }));

    return { yearly };
  }

  async getUserGrowthMonthly(
    duration: 'last_year' | 'last_month' | 'last_week' = 'last_year',
  ): Promise<{ data: UserGrowthMonthlyDto }> {
    const now = new Date();
    let startDate: Date;
    let genLabels: () => string[];
    let getLabel: (d: Date) => string;

    switch (duration) {
      case 'last_week': {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        getLabel = (d: Date) =>
          d.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
        genLabels = () => {
          const labels: string[] = [];
          for (let i = 0; i < 7; i++) {
            const day = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
            labels.push(getLabel(day));
          }
          return labels;
        };
        break;
      }
      case 'last_month': {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        getLabel = (d: Date) =>
          d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
        genLabels = () => {
          const labels: string[] = [];
          for (let i = 0; i < 30; i++) {
            const day = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
            labels.push(getLabel(day));
          }
          return labels;
        };
        break;
      }
      case 'last_year':
      default: {
        startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        getLabel = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
        genLabels = () => {
          const labels: string[] = [];
          const d = new Date(startDate);
          while (d <= now) {
            labels.push(getLabel(d));
            d.setMonth(d.getMonth() + 1);
          }
          return [...new Set(labels)];
        };
        break;
      }
    }

    const labels = genLabels();

    const users = await this.userRepo.findManyForGrowthMonthly(startDate);

    const freeCounts = new Array(labels.length).fill(0);
    const paidCounts = new Array(labels.length).fill(0);

    users.forEach((u) => {
      const label = getLabel(u.createdAt);
      const index = labels.indexOf(label);
      if (index !== -1) {
        const isPaid = u.subscription?.status === 'active';
        if (isPaid) paidCounts[index]++;
        else freeCounts[index]++;
      }
    });

    return {
      data: {
        labels,
        freeUsers: freeCounts,
        paidUsers: paidCounts,
      },
    };
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

  async getGuestStats(): Promise<GuestStatsDto> {
    const cached = await this.cacheManager.get<GuestStatsDto>(
      CACHE_KEYS.GUEST_STATS,
    );
    if (cached) return cached;

    const now = new Date();
    const rangeThisMonth = DateUtil.getRange(Timeframe.THIS_MONTH, now);
    const rangeLastMonth = DateUtil.getRange(Timeframe.LAST_MONTH, now);
    // Total counts
    const [totalSessions, totalStoriesRead, quotaExhausted] = await Promise.all(
      [
        this.activityRepo.count({
          action: GUEST_SESSION_CREATED,
          isDeleted: false,
        }),
        this.activityRepo.count({
          action: GUEST_STORY_ACCESSED,
          isDeleted: false,
        }),
        this.activityRepo.count({
          action: GUEST_QUOTA_EXHAUSTED,
          isDeleted: false,
        }),
      ],
    );

    // This month counts
    const thisMonthWhere = {
      createdAt: { gte: rangeThisMonth.start },
      isDeleted: false,
    };
    const [sessionsThisMonth, storiesThisMonth, quotaThisMonth] =
      await Promise.all([
        this.activityRepo.count({
          ...thisMonthWhere,
          action: GUEST_SESSION_CREATED,
        }),
        this.activityRepo.count({
          ...thisMonthWhere,
          action: GUEST_STORY_ACCESSED,
        }),
        this.activityRepo.count({
          ...thisMonthWhere,
          action: GUEST_QUOTA_EXHAUSTED,
        }),
      ]);

    // Last month counts for trend
    const lastMonthWhere = {
      createdAt: { gte: rangeLastMonth.start, lt: rangeThisMonth.start },
      isDeleted: false,
    };
    const [sessionsLastMonth, storiesLastMonth, quotaLastMonth] =
      await Promise.all([
        this.activityRepo.count({
          ...lastMonthWhere,
          action: GUEST_SESSION_CREATED,
        }),
        this.activityRepo.count({
          ...lastMonthWhere,
          action: GUEST_STORY_ACCESSED,
        }),
        this.activityRepo.count({
          ...lastMonthWhere,
          action: GUEST_QUOTA_EXHAUSTED,
        }),
      ]);

    // Unique stories accessed
    const uniqueStoriesAccessed =
      await this.analyticsRepo.countUniqueGuestStories(GUEST_STORY_ACCESSED);

    const timeframe = TrendLabel.VS_LAST_MONTH;
    const result: GuestStatsDto = {
      totalSessions,
      sessionsThisMonth: DashboardUtil.calculateTrend(
        sessionsThisMonth,
        sessionsLastMonth,
        timeframe,
      ),
      totalStoriesRead,
      storiesReadThisMonth: DashboardUtil.calculateTrend(
        storiesThisMonth,
        storiesLastMonth,
        timeframe,
      ),
      quotaExhausted,
      quotaExhaustedThisMonth: DashboardUtil.calculateTrend(
        quotaThisMonth,
        quotaLastMonth,
        timeframe,
      ),
      uniqueStoriesAccessed,
    };

    await this.cacheManager.set(
      CACHE_KEYS.GUEST_STATS,
      result,
      CACHE_TTL_MS.DASHBOARD,
    );
    return result;
  }

  async getGuestActivity(filters: GuestActivityFilterDto) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 10));
    const where: Prisma.ActivityLogWhereInput = {
      action: { startsWith: 'GUEST_' },
      isDeleted: false,
    };
    if (filters.action) {
      if (!filters.action.startsWith('GUEST_')) {
        throw new BadRequestException('Invalid guest action filter');
      }
      where.action = filters.action;
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate)
          ? new Date(`${filters.startDate}T00:00:00.000Z`)
          : new Date(filters.startDate);
      }
      if (filters.endDate) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(filters.endDate)) {
          const endDate = new Date(`${filters.endDate}T00:00:00.000Z`);
          endDate.setUTCDate(endDate.getUTCDate() + 1);
          where.createdAt.lt = endDate;
        } else {
          where.createdAt.lte = new Date(filters.endDate);
        }
      }
    }

    const [data, total] = await Promise.all([
      this.activityRepo.findGuestActivity({
        where,
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.activityRepo.count(where),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
