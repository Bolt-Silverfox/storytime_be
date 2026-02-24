import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IAdminAnalyticsRepository } from './admin-analytics.repository.interface';
import { Role } from '@prisma/client';
import { DateRangeDto } from '../dto/admin-filters.dto';
import {
  DashboardStatsDto,
  UserGrowthDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SubscriptionAnalyticsDto,
  RevenueAnalyticsDto,
  AiCreditAnalyticsDto,
  UserGrowthMonthlyDto,
} from '../dto/admin-responses.dto';
import { DateUtil } from '@/shared/utils/date.util';
import { Timeframe, TrendLabel } from '@/shared/constants/time.constants';
import { DashboardUtil } from '../utils/dashboard.util';

@Injectable()
export class PrismaAdminAnalyticsRepository
  implements IAdminAnalyticsRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats(): Promise<DashboardStatsDto> {
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

    const countBetween = (
      modelName: any,
      start: Date,
      end: Date,
    ): Promise<number> =>
      (this.prisma as any)[modelName].count({
        where: { createdAt: { gte: start, lte: end }, isDeleted: false },
      });

    // Current Metrics
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
      totalUsersCount,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { role: Role.parent, isDeleted: false },
      }),
      this.prisma.kid.count({ where: { isDeleted: false } }),
      this.prisma.user.count({ where: { role: Role.admin, isDeleted: false } }),
      this.prisma.story.count({ where: { isDeleted: false } }),
      this.prisma.category.count({ where: { isDeleted: false } }),
      this.prisma.theme.count({ where: { isDeleted: false } }),

      this.prisma.user.count({
        where: { updatedAt: { gte: range24h.start }, isDeleted: false },
      }),
      this.prisma.user.count({
        where: { updatedAt: { gte: range7d.start }, isDeleted: false },
      }),
      this.prisma.user.count({
        where: { updatedAt: { gte: range30d.start }, isDeleted: false },
      }),

      countBetween('user', rangeToday.start, rangeToday.end),
      countBetween('user', rangeThisMonth.start, rangeThisMonth.end),

      this.prisma.storyProgress.count(),
      this.prisma.favorite.count(),
      this.prisma.subscription.count(),
      this.prisma.subscription.count({
        where: {
          status: 'active',
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: { status: 'success' },
        _sum: { amount: true },
      }),
      this.prisma.user.count({ where: { isDeleted: false } }),
    ]);

    const totalRevenue = totalRevenueResult._sum.amount || 0;

    // Previous Metrics
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

    // Active & New Trends
    const [
      prevActiveUsers24h,
      prevActiveUsers7d,
      prevActiveUsers30d,
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
      countBetween('user', rangeLastMonth.start, rangeLastMonth.end),
    ]);

    const subscriptionPlans = await this.prisma.subscription.groupBy({
      by: ['plan'],
      where: {
        status: 'active',
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      _count: true,
    });

    const paidUsers = activeSubscriptionsCount;
    const unpaidUsers = totalUsersCount - paidUsers;
    const prevPaidUsers = prevActiveSubscriptionsCount;
    const prevUnpaidUsers = prevTotalUsers - prevPaidUsers;

    return {
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
      averageSessionTime: 0,
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
    } as DashboardStatsDto;
  }

  async getUserGrowth(dateRange: DateRangeDto): Promise<UserGrowthDto[]> {
    const startDate = dateRange.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange.endDate
      ? new Date(dateRange.endDate)
      : new Date();

    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: startDate, lte: endDate }, isDeleted: false },
      include: { subscription: true },
      orderBy: { createdAt: 'asc' },
    });

    const groupedByDate = users.reduce(
      (acc, user) => {
        const date = user.createdAt.toISOString().split('T')[0];
        if (!acc[date]) acc[date] = { total: 0, paid: 0 };
        acc[date].total += 1;
        if (user.subscription && user.subscription.status === 'active')
          acc[date].paid += 1;
        return acc;
      },
      {} as Record<string, { total: number; paid: number }>,
    );

    let totalUsers = await this.prisma.user.count({
      where: { createdAt: { lt: startDate }, isDeleted: false },
    });
    let totalPaidUsers = await this.prisma.user.count({
      where: {
        createdAt: { lt: startDate },
        isDeleted: false,
        subscription: { is: { status: 'active' } },
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

    return {
      totalStories,
      publishedStories,
      draftStories: 0,
      aiGeneratedStories,
      recommendedStories,
      deletedStories,
      totalViews,
      totalFavorites,
    };
  }

  async getContentBreakdown(): Promise<ContentBreakdownDto> {
    const [languageStats, categoryStats, themeStats] = await Promise.all([
      this.prisma.story.groupBy({
        by: ['language'],
        where: { isDeleted: false },
        _count: true,
      }),
      this.prisma.category.findMany({
        where: { isDeleted: false },
        select: { name: true, _count: { select: { stories: true } } },
      }),
      this.prisma.theme.findMany({
        where: { isDeleted: false },
        select: { name: true, _count: { select: { stories: true } } },
      }),
    ]);

    const ageGroupStats = await this.prisma.story.groupBy({
      by: ['ageMin', 'ageMax'],
      where: { isDeleted: false },
      _count: true,
    });

    const ageGroups = ageGroupStats.map((stat: any) => ({
      ageRange: `${stat.ageMin}-${stat.ageMax}`,
      count:
        typeof stat._count === 'number' ? stat._count : stat._count?._all || 0,
    }));

    return {
      byLanguage: languageStats.map((stat) => ({
        language: stat.language,
        count: stat._count,
      })),
      byAgeGroup: ageGroups,
      byCategory: categoryStats.map((cat: any) => ({
        categoryName: cat.name,
        count: cat._count.stories,
      })),
      byTheme: themeStats.map((theme: any) => ({
        themeName: theme.name,
        count: theme._count.stories,
      })),
    } as ContentBreakdownDto;
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

    const [subscription, revenue, planBreakdown] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['startedAt'],
        where: { startedAt: { gte: startDate, lte: endDate } },
        _count: true,
      }),
      this.prisma.paymentTransaction.groupBy({
        by: ['createdAt'],
        where: {
          createdAt: { gte: startDate, lte: endDate },
          status: 'success',
        },
        _sum: { amount: true },
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
      subscriptionGrowth: subscription.map((sub) => ({
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
      where: { startedAt: { lt: startDate }, status: 'active' },
    });

    const churnedSubscriptions = await this.prisma.subscription.count({
      where: {
        OR: [
          { status: 'cancelled' },
          { status: 'active', endsAt: { gte: startDate, lte: endDate } },
        ],
      },
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

    const dailyRevenue = await this.prisma.paymentTransaction.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: 'success',
      },
      _sum: { amount: true },
      orderBy: { createdAt: 'asc' },
    });

    const allTransactions = await this.prisma.paymentTransaction.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: 'success',
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
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

    const subscriptionWithRevenue = await this.prisma.subscription.findMany({
      where: { status: 'active' },
      include: {
        user: {
          include: {
            paymentTransactions: {
              where: { status: 'success' },
              select: { amount: true },
            },
          },
        },
      },
    });

    const planRevenueMap = new Map<
      string,
      { subscription_count: number; total_revenue: number }
    >();

    subscriptionWithRevenue.forEach((sub) => {
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

    return {
      dailyRevenue: dailyRevenue.map((day) => ({
        date: day.createdAt.toISOString().split('T')[0],
        amount: day._sum.amount || 0,
      })),
      monthlyRevenue: Array.from(monthlyRevenueMap.entries()).map(
        ([month, total]) => ({ month, total_amount: total }),
      ),
      yearlyRevenue: Array.from(yearlyRevenueMap.entries()).map(
        ([year, total]) => ({ year, total_amount: total }),
      ),
      topPlans: Array.from(planRevenueMap.entries())
        .map(([plan, stats]) => ({
          plan,
          subscription_count: stats.subscription_count,
          total_revenue: stats.total_revenue,
        }))
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 10),
    };
  }

  async getAiCreditAnalytics(): Promise<AiCreditAnalyticsDto> {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);
    const logs = await this.prisma.activityLog.findMany({
      where: { action: 'AI_GENERATION', createdAt: { gte: startOfYear } },
      select: { createdAt: true, details: true },
    });

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
    months.forEach((m) =>
      dataMap.set(m, { elevenLabs: 0, gemini: 0, total: 0 }),
    );

    logs.forEach((log) => {
      const month = log.createdAt.toLocaleString('default', { month: 'short' });
      if (!dataMap.has(month)) return;

      let credits = 1;
      let provider = '';
      try {
        const details = JSON.parse(log.details || '{}');
        credits = details.credits || 1;
        provider = details.provider || '';
      } catch {
        // Ignore malformed JSON in log details
      }

      const entry = dataMap.get(month)!;
      if (provider === 'elevenlabs') entry.elevenLabs += credits;
      if (provider === 'gemini') entry.gemini += credits;
      entry.total += credits;
    });

    return {
      yearly: months.map((m) => ({ month: m, ...dataMap.get(m)! })),
    };
  }

  async getUserGrowthMonthly(): Promise<{ data: UserGrowthMonthlyDto[] }> {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const users = await this.prisma.user.findMany({
      where: { createdAt: { gte: startDate }, isDeleted: false },
      select: {
        createdAt: true,
        id: true,
        subscription: { select: { id: true, status: true } },
      },
    });

    const labels: string[] = [];
    const d = new Date(startDate);
    while (d <= now) {
      labels.push(d.toLocaleString('default', { month: 'short' }));
      d.setMonth(d.getMonth() + 1);
    }
    const uniqueLabels = [...new Set(labels)];

    const freeCounts = new Array(uniqueLabels.length).fill(0);
    const paidCounts = new Array(uniqueLabels.length).fill(0);

    users.forEach((u) => {
      const label = u.createdAt.toLocaleString('default', { month: 'short' });
      const index = uniqueLabels.indexOf(label);
      if (index !== -1) {
        if (u.subscription && u.subscription.status === 'active')
          paidCounts[index]++;
        else freeCounts[index]++;
      }
    });

    return {
      data: [
        {
          labels: uniqueLabels,
          freeUsers: freeCounts,
          paidUsers: paidCounts,
        },
      ],
    };
  }
}
