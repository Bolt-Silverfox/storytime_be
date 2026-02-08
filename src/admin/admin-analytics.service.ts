import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
} from '@nestjs/common';
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

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
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

    const rangeYesterday = DateUtil.getRange(Timeframe.YESTERDAY, now);

    // Helper to count between dates
    const countBetween = (
      model: { count: (args: { where: object }) => Promise<number> },
      start: Date,
      end: Date,
    ): Promise<number> =>
      model.count({
        where: { createdAt: { gte: start, lte: end }, isDeleted: false },
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
      this.prisma.user.count({
        where: { role: Role.parent, isDeleted: false },
      }),
      this.prisma.kid.count({ where: { isDeleted: false } }),
      this.prisma.user.count({ where: { role: Role.admin, isDeleted: false } }),
      this.prisma.story.count({ where: { isDeleted: false } }),
      this.prisma.category.count({ where: { isDeleted: false } }),
      this.prisma.theme.count({ where: { isDeleted: false } }),

      // Active Users
      this.prisma.user.count({
        where: { updatedAt: { gte: range24h.start }, isDeleted: false },
      }),
      this.prisma.user.count({
        where: { updatedAt: { gte: range7d.start }, isDeleted: false },
      }),
      this.prisma.user.count({
        where: { updatedAt: { gte: range30d.start }, isDeleted: false },
      }),

      // New Users
      countBetween(this.prisma.user, rangeToday.start, rangeToday.end),
      countBetween(this.prisma.user, rangeThisMonth.start, rangeThisMonth.end),

      // Engagement
      this.prisma.storyProgress.count(),
      this.prisma.favorite.count(),

      // Subs
      this.prisma.subscription.count(),
      this.prisma.subscription.count({
        where: {
          status: 'active',
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      }),

      // Revenue
      this.prisma.paymentTransaction.aggregate({
        where: { status: 'success' },
        _sum: { amount: true },
      }),
    ]);

    const totalUsersCount = await this.prisma.user.count({
      where: { isDeleted: false },
    });
    const totalRevenue = totalRevenueResult._sum.amount || 0;

    // 2. Fetch Previous Period Metrics for Trends
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
      this.prisma.user.count({
        where: { createdAt: { lte: lastMonthEnd }, isDeleted: false },
      }),
      this.prisma.user.count({
        where: {
          role: Role.parent,
          createdAt: { lte: lastMonthEnd },
          isDeleted: false,
        },
      }),
      this.prisma.kid.count({
        where: { createdAt: { lte: lastMonthEnd }, isDeleted: false },
      }),
      this.prisma.user.count({
        where: {
          role: Role.admin,
          createdAt: { lte: lastMonthEnd },
          isDeleted: false,
        },
      }),
      this.prisma.story.count({
        where: { createdAt: { lte: lastMonthEnd }, isDeleted: false },
      }),
      this.prisma.category.count({ where: { isDeleted: false } }),
      this.prisma.theme.count({ where: { isDeleted: false } }),

      this.prisma.storyProgress.count({
        where: { lastAccessed: { lte: lastMonthEnd } },
      }),
      this.prisma.favorite.count({
        where: { createdAt: { lte: lastMonthEnd } },
      }),
      this.prisma.subscription.count({
        where: { startedAt: { lte: lastMonthEnd } },
      }),

      this.prisma.subscription.count({
        where: {
          status: 'active',
          startedAt: { lte: lastMonthEnd },
          OR: [{ endsAt: null }, { endsAt: { gt: lastMonthEnd } }],
        },
      }),

      this.prisma.paymentTransaction.aggregate({
        where: { status: 'success', createdAt: { lte: lastMonthEnd } },
        _sum: { amount: true },
      }),
    ]);

    const prevTotalRevenue = prevTotalRevenueResult._sum.amount || 0;

    // Trends for "Active" & "New" metrics
    const [
      prevActiveUsers24h,
      prevActiveUsers7d,
      prevActiveUsers30d,
      _unused, // eslint-disable-line @typescript-eslint/no-unused-vars
      prevNewUsersThisMonth,
    ] = await Promise.all([
      this.prisma.user.count({
        where: {
          updatedAt: { gte: prevRange24h.start, lt: prevRange24h.end },
          isDeleted: false,
        },
      }),
      this.prisma.user.count({
        where: {
          updatedAt: { gte: prevRange7d.start, lt: prevRange7d.end },
          isDeleted: false,
        },
      }),
      this.prisma.user.count({
        where: {
          updatedAt: { gte: prevRange30d.start, lt: prevRange30d.end },
          isDeleted: false,
        },
      }),

      countBetween(this.prisma.user, rangeYesterday.start, rangeYesterday.end),
      countBetween(this.prisma.user, rangeLastMonth.start, rangeLastMonth.end),
    ]);

    // Subscription breakdown
    const subscriptionPlans = await this.prisma.subscription.groupBy({
      by: ['plan'],
      where: {
        status: 'active',
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      _count: true,
    });

    const avgSessionTime = 0;
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
        ),

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

  // =====================
  // USER GROWTH
  // =====================

  async getUserGrowth(dateRange: DateRangeDto): Promise<UserGrowthDto[]> {
    const startDate = dateRange.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    const users = await this.prisma.user.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        isDeleted: false,
      },
      include: {
        subscriptions: {
          where: {
            status: 'active',
          },
        },
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
        if (user.subscriptions.length > 0) {
          acc[date].paid += 1;
        }
        return acc;
      },
      {} as Record<string, { total: number; paid: number }>,
    );

    let totalUsers = await this.prisma.user.count({
      where: {
        createdAt: { lt: startDate },
        isDeleted: false,
      },
    });

    let totalPaidUsers = await this.prisma.user.count({
      where: {
        createdAt: { lt: startDate },
        isDeleted: false,
        subscriptions: {
          some: {
            status: 'active',
          },
        },
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

    const [
      totalStories,
      publishedStories,
      aiGeneratedStories,
      recommendedStories,
      deletedStories,
      totalViews,
      totalFavorites,
    ] = await Promise.all([
      this.prisma.story.count({ where: { isDeleted: false } }),
      this.prisma.story.count({ where: { isDeleted: false } }),
      this.prisma.story.count({
        where: { aiGenerated: true, isDeleted: false },
      }),
      this.prisma.story.count({
        where: { recommended: true, isDeleted: false },
      }),
      this.prisma.story.count({ where: { isDeleted: true } }),
      this.prisma.storyProgress.count(),
      this.prisma.favorite.count(),
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

    const [languageStats, categoryStats, themeStats] = await Promise.all([
      this.prisma.story.groupBy({
        by: ['language'],
        where: { isDeleted: false },
        _count: true,
      }),
      this.prisma.category.findMany({
        where: { isDeleted: false },
        select: {
          name: true,
          _count: {
            select: { stories: true },
          },
        },
      }),
      this.prisma.theme.findMany({
        where: { isDeleted: false },
        select: {
          name: true,
          _count: {
            select: { stories: true },
          },
        },
      }),
    ]);

    const stories = await this.prisma.story.findMany({
      where: { isDeleted: false },
      select: { ageMin: true, ageMax: true },
    });

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
      await this.prisma.$queryRaw`SELECT 1`;
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
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    const [subscriptions, revenue, planBreakdown] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['startedAt'],
        where: {
          startedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        _count: true,
      }),
      this.prisma.paymentTransaction.groupBy({
        by: ['createdAt'],
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          status: 'success',
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.subscription.groupBy({
        by: ['plan'],
        where: {
          status: 'active',
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
        _count: true,
      }),
    ]);

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
    const totalSubscriptionsAtStart = await this.prisma.subscription.count({
      where: {
        startedAt: { lt: startDate },
        status: 'active',
      },
    });

    const churnedSubscriptions = await this.prisma.subscription.count({
      where: {
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
      },
    });

    return totalSubscriptionsAtStart > 0
      ? (churnedSubscriptions / totalSubscriptionsAtStart) * 100
      : 0;
  }

  // =====================
  // REVENUE ANALYTICS
  // =====================

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
      const dailyRevenue = await this.prisma.paymentTransaction.groupBy({
        by: ['createdAt'],
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          status: 'success',
        },
        _sum: {
          amount: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const allTransactions = await this.prisma.paymentTransaction.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          status: 'success',
        },
        select: {
          amount: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const monthlyRevenueMap = new Map<string, number>();
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

      const subscriptionsWithRevenue = await this.prisma.subscription.findMany({
        where: {
          status: 'active',
        },
        include: {
          user: {
            include: {
              paymentTransactions: {
                where: {
                  status: 'success',
                },
                select: {
                  amount: true,
                },
              },
            },
          },
        },
      });

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

  // =====================
  // AI CREDIT ANALYTICS
  // =====================

  async getAiCreditAnalytics(): Promise<AiCreditAnalyticsDto> {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);

    const logs = await this.prisma.activityLog.findMany({
      where: {
        action: 'AI_GENERATION',
        createdAt: { gte: startOfYear },
      },
    });

    const getMonthKey = (d: Date) =>
      d.toLocaleString('default', { month: 'short' });
    const months = [
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

    const dataMap = new Map<
      string,
      { elevenLabs: number; gemini: number; total: number }
    >();
    months.forEach((m) => {
      dataMap.set(m, { elevenLabs: 0, gemini: 0, total: 0 });
    });

    logs.forEach((log) => {
      const month = getMonthKey(log.createdAt);
      if (!dataMap.has(month)) return;

      let credits = 1;
      let provider = '';
      try {
        const details = JSON.parse(log.details || '{}');
        credits = details.credits || 1;
        provider = details.provider || '';
      } catch {
        // Fallback
      }

      const entry = dataMap.get(month)!;
      if (provider === String(AiProviders.ElevenLabs))
        entry.elevenLabs += credits;
      if (provider === String(AiProviders.Gemini)) entry.gemini += credits;
      entry.total += credits;
    });

    const yearly = months.map((m) => ({
      month: m,
      ...dataMap.get(m)!,
    }));

    return { yearly };
  }

  // =====================
  // USER GROWTH MONTHLY
  // =====================

  async getUserGrowthMonthly(): Promise<UserGrowthMonthlyDto> {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { gte: startDate },
        isDeleted: false,
      },
      select: {
        createdAt: true,
        id: true,
        subscriptions: { where: { status: 'active' } },
      },
    });

    const getMonthLabel = (d: Date) => {
      return d.toLocaleString('default', { month: 'short' });
    };

    const labels: string[] = [];
    const d = new Date(startDate);
    while (d <= now) {
      labels.push(getMonthLabel(d));
      d.setMonth(d.getMonth() + 1);
    }
    const uniqueLabels = [...new Set(labels)];

    const freeCounts = new Array(uniqueLabels.length).fill(0);
    const paidCounts = new Array(uniqueLabels.length).fill(0);

    users.forEach((u) => {
      const label = getMonthLabel(u.createdAt);
      const index = uniqueLabels.indexOf(label);
      if (index !== -1) {
        const isPaid = u.subscriptions.length > 0;
        if (isPaid) paidCounts[index]++;
        else freeCounts[index]++;
      }
    });

    return {
      data: {
        labels: uniqueLabels,
        freeUsers: freeCounts,
        paidUsers: paidCounts,
      },
    };
  }
}
