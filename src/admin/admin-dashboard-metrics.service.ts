import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Role } from '@prisma/client';
import {
  DashboardStatsDto,
  UserGrowthDto,
  StoryStatsDto,
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
} from './repositories';

@Injectable()
export class AdminDashboardMetricsService {
  private readonly logger = new Logger(AdminDashboardMetricsService.name);

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
      newUsersThisWeek,
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
      countBetween(range7d.start, range7d.end),
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
      newUsersThisWeek,
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
      draftStories,
      aiGeneratedStories,
      recommendedStories,
      deletedStories,
      totalViews,
      totalFavorites,
    ] = await Promise.all([
      this.storyRepo.countStories({ isDeleted: false }),
      this.storyRepo.countStories({ isDeleted: false, isPublished: true }), // publishedStories
      this.storyRepo.countStories({ isDeleted: false, isPublished: false }), // draftStories
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
      draftStories,
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
}
