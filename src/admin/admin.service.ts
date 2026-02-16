import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviders } from '@/shared/constants/ai-providers.constants';
import { Role, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  DashboardStatsDto,
  UserGrowthDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SystemHealthDto,
  PaginatedResponseDto,
  SubscriptionAnalyticsDto,
  RevenueAnalyticsDto,
  CategoryDto,
  ThemeDto,
  SubscriptionDto,
  ActivityLogDto,
  AiCreditAnalyticsDto,
  UserGrowthMonthlyDto,
} from './dto/admin-responses.dto';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import {
  UserFilterDto,
  StoryFilterDto,
  DateRangeDto,
} from './dto/admin-filters.dto';
import {
  CreateAdminDto,
  UpdateUserDto,
  BulkActionDto,
} from './dto/user-management.dto';
import {
  categories,
  themes,
  defaultAgeGroups,
  systemAvatars,
} from '../../prisma/data';
import { DateUtil } from '@/shared/utils/date.util';
import { Timeframe, TrendLabel } from '@/shared/constants/time.constants';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
  STORY_INVALIDATION_KEYS,
} from '@/shared/constants/cache-keys.constants';
import { DashboardUtil } from './utils/dashboard.util';

const PERMANENT_DELETION_MSG = 'Permanent deletion requested';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
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

    const rangeYesterday = DateUtil.getRange(Timeframe.YESTERDAY, now); // For "New Users Today" comparison

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
      this.prisma.storyProgress.count(), // Total views (cumulative)
      this.prisma.favorite.count(), // Total favorites (cumulative)

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

      // Active Subs History (Approximate)
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

    // Trends for "Active" & "New" metrics (Time shifting)
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

      // New Users Today vs Yesterday
      countBetween(this.prisma.user, rangeYesterday.start, rangeYesterday.end),
      // New Users This Month vs Last Month
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

    const users = await this.prisma.user.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        isDeleted: false,
      },
      include: {
        subscription: true,
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
        subscription: {
          status: 'active',
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

    // Age group breakdown based on story age ranges
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
  // USER MANAGEMENT
  // =====================

  async getAllUsers(
    filters: UserFilterDto,
  ): Promise<PaginatedResponseDto<any>> {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      role,
      isEmailVerified,
      isDeleted,
      createdAfter,
      createdBefore,
    } = filters;

    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) where.role = role;
    if (isEmailVerified !== undefined) where.isEmailVerified = isEmailVerified;

    if (isDeleted !== undefined) where.isDeleted = isDeleted;

    if (createdAfter || createdBefore) {
      where.createdAt = {};
      if (createdAfter) where.createdAt.gte = new Date(createdAfter);
      if (createdBefore) where.createdAt.lte = new Date(createdBefore);
    }

    // Filter by subscription status
    const hasActiveSub = filters.hasActiveSubscription;
    if (hasActiveSub !== undefined && hasActiveSub !== null) {
      const now = new Date();
      // Normalize value - handle both boolean and string (query params may come as strings)
      const wantsActiveSubscription =
        hasActiveSub === true || String(hasActiveSub) === 'true';

      const activeSubscriptionCriteria = {
        status: 'active',
        isDeleted: false,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      };

      if (wantsActiveSubscription) {
        where.subscription = activeSubscriptionCriteria;
      } else {
        where.OR = [
          { subscription: null },
          { subscription: { NOT: activeSubscriptionCriteria } },
        ];
      }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          subscription: {
            select: {
              id: true,
              plan: true,
              status: true,
              endsAt: true,
            },
          },
          profile: true,
          avatar: true,
          usage: {
            select: { elevenLabsCount: true },
          },
          kids: {
            select: {
              screenTimeSessions: {
                select: { duration: true },
              },
            },
          },
          paymentTransactions: {
            where: { status: 'success' },
            select: { amount: true },
          },
          _count: {
            select: {
              kids: true,
              auth: true,
              parentFavorites: true,
              paymentTransactions: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((user) => {
        // Sanitize user object - exclude sensitive fields
        const {
          passwordHash, // eslint-disable-line @typescript-eslint/no-unused-vars
          pinHash, // eslint-disable-line @typescript-eslint/no-unused-vars
          kids, // eslint-disable-line @typescript-eslint/no-unused-vars
          paymentTransactions, // eslint-disable-line @typescript-eslint/no-unused-vars
          usage, // eslint-disable-line @typescript-eslint/no-unused-vars
          subscription, // eslint-disable-line @typescript-eslint/no-unused-vars
          ...safeUser
        } = user;

        // Calculate metrics
        const creditUsed = user.usage?.elevenLabsCount || 0;
        const activityLength = user.kids.reduce(
          (total, kid) =>
            total +
            kid.screenTimeSessions.reduce(
              (sum, s) => sum + (s.duration || 0),
              0,
            ),
          0,
        );
        const amountSpent = user.paymentTransactions.reduce(
          (sum, txn) => sum + txn.amount,
          0,
        );

        // Check if user has active subscription (same logic as getUserById)
        const now = new Date();
        const hasActiveSubscription =
          user.subscription?.status === 'active' &&
          (!user.subscription.endsAt || user.subscription.endsAt > now);

        return {
          ...safeUser,
          registrationDate: user.createdAt,
          activityLength,
          creditUsed,
          amountSpent,
          isPaidUser: hasActiveSubscription,
          activeSubscription: hasActiveSubscription ? user.subscription : null,
          kidsCount: user._count.kids,
          sessionsCount: user._count.auth,
          favoritesCount: user._count.parentFavorites,
          transactionsCount: user._count.paymentTransactions,
        };
      }),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        kids: {
          where: { isDeleted: false },
          select: {
            id: true,
            name: true,
            ageRange: true,
            createdAt: true,
            avatar: true,
          },
        },
        avatar: true,
        subscription: true,
        paymentTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            auth: true,
            parentFavorites: true,
            voices: true,
            supportTickets: true,
            paymentTransactions: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Check if user has active subscription
    const now = new Date();
    const hasActiveSubscription =
      user.subscription?.status === 'active' &&
      (!user.subscription.endsAt || user.subscription.endsAt > now);

    const totalSpentResult = await this.prisma.paymentTransaction.aggregate({
      where: {
        userId: userId,
        status: 'success',
      },
      _sum: {
        amount: true,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, pinHash, ...safeUser } = user;

    return {
      ...safeUser,
      isPaidUser: hasActiveSubscription,
      totalSpent: totalSpentResult._sum.amount || 0,
      stats: {
        sessionsCount: user._count.auth,
        favoritesCount: user._count.parentFavorites,
        voicesCount: user._count.voices,
        ticketsCount: user._count.supportTickets,
        transactionsCount: user._count.paymentTransactions,
      },
      _count: undefined,
    };
  }

  async createAdmin(data: CreateAdminDto): Promise<any> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: Role.admin,
        isEmailVerified: true,
        profile: {
          create: {
            country: 'NG',
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async updateUser(
    userId: string,
    data: UpdateUserDto,
    currentAdminId?: string,
  ): Promise<any> {
    // Safety check: prevent self-demotion
    if (userId === currentAdminId && data.role && data.role !== Role.admin) {
      throw new BadRequestException(
        'You cannot demote yourself from admin status.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (data.email && data.email !== user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existingUser) {
        throw new ConflictException('Email already in use');
      }
    }

    const updateData: Prisma.UserUpdateInput = {
      ...(data.name && { name: data.name }),
      ...(data.role && { role: data.role }),
      ...(data.email && { email: data.email }),
    };

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isEmailVerified: true,
        updatedAt: true,
      },
    });
  }

  async deleteUser(
    userId: string,
    permanent: boolean = false,
    currentAdminId?: string,
  ): Promise<any> {
    // Safety check: prevent self-deletion
    if (userId === currentAdminId) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (permanent) {
      return this.prisma.user.delete({ where: { id: userId } });
    } else {
      return this.prisma.user.update({
        where: { id: userId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    }
  }

  async restoreUser(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  async bulkUserAction(data: BulkActionDto): Promise<{ count: number }> {
    const { userIds, action } = data;

    switch (action) {
      case 'delete': {
        const deleteResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        });
        return { count: deleteResult.count };
      }

      case 'restore': {
        const restoreResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isDeleted: false,
            deletedAt: null,
          },
        });
        return { count: restoreResult.count };
      }

      case 'verify': {
        const verifyResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isEmailVerified: true,
          },
        });
        return { count: verifyResult.count };
      }

      default:
        throw new BadRequestException('Invalid action');
    }
  }

  // =====================
  // STORY MANAGEMENT
  // =====================

  async getAllStories(
    filters: StoryFilterDto,
  ): Promise<PaginatedResponseDto<any>> {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      recommended,
      aiGenerated,
      isDeleted,
      language,
      minAge,
      maxAge,
    } = filters;

    const skip = (page - 1) * limit;

    const where: Prisma.StoryWhereInput = {};

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (typeof recommended === 'boolean') where.recommended = recommended;
    if (typeof aiGenerated === 'boolean') where.aiGenerated = aiGenerated;
    if (typeof isDeleted === 'boolean') where.isDeleted = isDeleted;
    if (language) where.language = language;
    if (minAge) where.ageMin = { gte: minAge };
    if (maxAge) where.ageMax = { lte: maxAge };

    const [stories, total] = await Promise.all([
      this.prisma.story.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          categories: true,
          themes: true,
          _count: {
            select: {
              favorites: true,
              progresses: true,
              parentFavorites: true,
              downloads: true,
            },
          },
        },
      }),
      this.prisma.story.count({ where }),
    ]);

    return {
      data: stories.map((story) => ({
        ...story,
        favoritesCount: story._count.favorites,
        viewsCount: story._count.progresses,
        parentFavoritesCount: story._count.parentFavorites,
        downloadsCount: story._count.downloads,
        _count: undefined,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStoryById(storyId: string): Promise<any> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: {
        images: true,
        categories: true,
        themes: true,
        branches: true,
        questions: true,
        _count: {
          select: {
            favorites: true,
            progresses: true,
            parentFavorites: true,
            downloads: true,
          },
        },
      },
    });

    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    return {
      ...story,
      stats: {
        favoritesCount: story._count.favorites,
        viewsCount: story._count.progresses,
        parentFavoritesCount: story._count.parentFavorites,
        downloadsCount: story._count.downloads,
      },
      _count: undefined,
    };
  }

  async toggleStoryRecommendation(storyId: string): Promise<any> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    const result = await this.prisma.story.update({
      where: { id: storyId },
      data: { recommended: !story.recommended },
    });

    // Invalidate story stats cache for immediate dashboard accuracy
    try {
      await this.cacheManager.del(CACHE_KEYS.STORY_STATS);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate story stats cache: ${error.message}`,
      );
    }

    return result;
  }

  async deleteStory(storyId: string, permanent: boolean = false): Promise<any> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    let result;
    if (permanent) {
      result = await this.prisma.story.delete({ where: { id: storyId } });
    } else {
      result = await this.prisma.story.update({
        where: { id: storyId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    }

    // Invalidate dashboard caches for immediate accuracy
    try {
      await Promise.all(
        STORY_INVALIDATION_KEYS.map((key) => this.cacheManager.del(key)),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate dashboard caches: ${error.message}`,
      );
    }

    return result;
  }

  // =====================
  // CATEGORY & THEME MANAGEMENT
  // =====================

  async getCategories(): Promise<CategoryDto[]> {
    const categories = await this.prisma.category.findMany({
      where: { isDeleted: false },
      include: {
        _count: {
          select: {
            stories: true,
            preferredByKids: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      image: cat.image || undefined,
      description: cat.description || undefined,
      isDeleted: cat.isDeleted,
      deletedAt: cat.deletedAt || undefined,
      _count: {
        stories: cat._count.stories,
        preferredByKids: cat._count.preferredByKids,
      },
    }));
  }

  async getThemes(): Promise<ThemeDto[]> {
    const themes = await this.prisma.theme.findMany({
      where: { isDeleted: false },
      include: {
        _count: {
          select: {
            stories: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      image: theme.image || undefined,
      description: theme.description || undefined,
      isDeleted: theme.isDeleted,
      deletedAt: theme.deletedAt || undefined,
      _count: {
        stories: theme._count.stories,
      },
    }));
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
      // Get subscription growth
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
      // Get revenue growth
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
      // Get subscription plan breakdown
      this.prisma.subscription.groupBy({
        by: ['plan'],
        where: {
          status: 'active',
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
        _count: true,
      }),
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

      // For monthly and yearly revenue
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
  // SEED DATABASE
  // =====================

  async seedDatabase(): Promise<{ message: string }> {
    try {
      // Seed categories
      this.logger.log('Seeding categories...');
      for (const category of categories) {
        const existingCategory = await this.prisma.category.findFirst({
          where: { name: category.name },
        });

        if (existingCategory) {
          await this.prisma.category.update({
            where: { id: existingCategory.id },
            data: {
              image: category.image,
              description: category.description,
              isDeleted: false,
              deletedAt: null,
            },
          });
        } else {
          await this.prisma.category.create({
            data: {
              name: category.name,
              image: category.image,
              description: category.description,
            },
          });
        }
      }

      // Seed themes
      this.logger.log('Seeding themes...');
      for (const theme of themes) {
        const existingTheme = await this.prisma.theme.findFirst({
          where: { name: theme.name },
        });

        if (existingTheme) {
          await this.prisma.theme.update({
            where: { id: existingTheme.id },
            data: {
              image: theme.image,
              description: theme.description,
              isDeleted: false,
              deletedAt: null,
            },
          });
        } else {
          await this.prisma.theme.create({
            data: {
              name: theme.name,
              image: theme.image,
              description: theme.description,
            },
          });
        }
      }

      // Seed age groups
      this.logger.log('Seeding age groups...');
      for (const ageGroup of defaultAgeGroups) {
        const existingAgeGroup = await this.prisma.ageGroup.findFirst({
          where: { name: ageGroup.name },
        });

        if (existingAgeGroup) {
          await this.prisma.ageGroup.update({
            where: { id: existingAgeGroup.id },
            data: {
              min: ageGroup.min,
              max: ageGroup.max,
              isDeleted: false,
              deletedAt: null,
            },
          });
        } else {
          await this.prisma.ageGroup.create({
            data: {
              name: ageGroup.name,
              min: ageGroup.min,
              max: ageGroup.max,
            },
          });
        }
      }

      // Seed system avatars
      this.logger.log('Seeding system avatars...');
      for (const avatarData of systemAvatars) {
        const existingAvatar = await this.prisma.avatar.findFirst({
          where: {
            name: avatarData.name,
            isSystemAvatar: true,
          },
        });

        if (existingAvatar) {
          await this.prisma.avatar.update({
            where: { id: existingAvatar.id },
            data: {
              url: avatarData.url,
              isSystemAvatar: true,
              isDeleted: false,
              deletedAt: null,
            },
          });
        } else {
          await this.prisma.avatar.create({
            data: {
              name: avatarData.name,
              url: avatarData.url,
              isSystemAvatar: true,
              isDeleted: false,
              deletedAt: null,
            },
          });
        }
      }

      // Invalidate caches after seeding
      try {
        await Promise.all(
          STORY_INVALIDATION_KEYS.map((key) => this.cacheManager.del(key)),
        );
      } catch (cacheError) {
        this.logger.warn(
          `Failed to invalidate caches after seeding: ${cacheError.message}`,
        );
      }

      this.logger.log('✅ Database seeded successfully!');
      return { message: 'Database seeded successfully' };
    } catch (error) {
      this.logger.error('❌ Failed to seed database:', error);
      throw new BadRequestException('Failed to seed database');
    }
  }

  // =====================
  // AI ANALYTICS
  // =====================

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

    const logs = await this.prisma.activityLog.findMany({
      where: {
        action: 'AI_GENERATION',
        createdAt: { gte: startDate },
      },
    });

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

  // =====================
  // CUSTOM USER ANALYTICS
  // =====================

  async getUserGrowthMonthly(
    duration: 'last_year' | 'last_month' | 'last_week' = 'last_year',
  ): Promise<UserGrowthMonthlyDto> {
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

    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { gte: startDate },
        isDeleted: false,
      },
      select: {
        createdAt: true,
        id: true,
        subscription: true,
      },
    });

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

  async getRecentActivity(limit: number = 50): Promise<ActivityLogDto[]> {
    const activities = await this.prisma.activityLog.findMany({
      where: { isDeleted: false },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        kid: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return activities.map((activity) => ({
      id: activity.id,
      userId: activity.userId || undefined,
      kidId: activity.kidId || undefined,
      action: activity.action,
      status: activity.status,
      deviceName: activity.deviceName || undefined,
      deviceModel: activity.deviceModel || undefined,
      os: activity.os || undefined,
      ipAddress: activity.ipAddress || undefined,
      details: activity.details || undefined,
      createdAt: activity.createdAt,
      isDeleted: activity.isDeleted,
      deletedAt: activity.deletedAt || undefined,
      user: activity.user || undefined,
      kid: activity.kid || undefined,
    }));
  }

  // =====================
  // SYSTEM MANAGEMENT
  // =====================

  createBackup(): { message: string; timestamp: Date } {
    // Implement backup logic based on your database
    return { message: 'Backup created successfully', timestamp: new Date() };
  }

  async getSystemLogs(
    level?: string,
    limit: number = 100,
  ): Promise<ActivityLogDto[]> {
    const where: Prisma.ActivityLogWhereInput = { isDeleted: false };
    if (level) where.status = level;

    const logs = await this.prisma.activityLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

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

  // =====================
  // ADDITIONAL METHODS
  // =====================

  async getSubscriptions(status?: string): Promise<SubscriptionDto[]> {
    const where: Prisma.SubscriptionWhereInput = { isDeleted: false };

    if (status) {
      where.status = status;
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    return subscriptions.map((sub) => ({
      id: sub.id,
      plan: sub.plan,
      status: sub.status,
      startedAt: sub.startedAt,
      endsAt: sub.endsAt || undefined,
      isDeleted: sub.isDeleted,
      deletedAt: sub.deletedAt || undefined,
      user: sub.user,
    }));
  }

  // =====================
  // INTEGRATIONS & SUPPORT
  // =====================

  async getElevenLabsBalance() {
    return this.elevenLabsProvider.getSubscriptionInfo();
  }

  async getAllSupportTickets(
    page: number = 1,
    limit: number = 10,
    status?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.SupportTicketWhereInput = {};
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      data: tickets,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateSupportTicket(id: string, status: string) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { status },
    });
  }

  // =====================
  // EXPORT ENDPOINTS
  // =====================

  private sanitizeCsv(value: string | null | undefined): string {
    const escaped = (value || '').replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(escaped)) {
      return `\t${escaped}`;
    }
    return escaped;
  }

  async exportUsersAsCsv(filters: UserFilterDto): Promise<string> {
    // Paginate through all matching users
    const pageSize = 1000;
    let page = 1;
    const allUsers: any[] = [];
    while (true) {
      const result = await this.getAllUsers({
        ...filters,
        page,
        limit: pageSize,
      });
      allUsers.push(...result.data);
      if (result.data.length < pageSize) break;
      page++;
    }

    const headers = [
      'ID',
      'Email',
      'Name',
      'Role',
      'Email Verified',
      'Is Paid',
      'Subscription Plan',
      'Registration Date',
      'Is Deleted',
      'Is Suspended',
    ];

    const rows = allUsers.map((user: any) => [
      user.id,
      `"${this.sanitizeCsv(user.email)}"`,
      `"${this.sanitizeCsv(user.name)}"`,
      user.role,
      user.isEmailVerified,
      user.isPaidUser,
      user.activeSubscription?.plan || '',
      user.registrationDate
        ? new Date(user.registrationDate).toISOString()
        : '',
      user.isDeleted,
      user.isSuspended || false,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((r: any[]) => r.join(',')),
    ].join('\n');
    return csv;
  }

  async exportAnalyticsData(
    type: 'users' | 'revenue' | 'subscriptions',
    format: 'csv' | 'json' = 'csv',
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: any; contentType: string; filename: string }> {
    const dateRange = { startDate, endDate };

    let rawData: any;
    let csvContent = '';
    let filename: string;

    switch (type) {
      case 'users': {
        const growth = await this.getUserGrowth(dateRange);
        rawData = growth;
        filename = `users-analytics-${new Date().toISOString().split('T')[0]}`;
        if (format === 'csv') {
          const headers = [
            'Date',
            'New Users',
            'Paid Users',
            'Total Users',
            'Total Paid Users',
          ];
          const rows = growth.map((g) =>
            [
              g.date,
              g.newUsers,
              g.paidUsers,
              g.totalUsers,
              g.totalPaidUsers,
            ].join(','),
          );
          csvContent = [headers.join(','), ...rows].join('\n');
        }
        break;
      }
      case 'revenue': {
        const revenue = await this.getRevenueAnalytics(dateRange);
        rawData = revenue;
        filename = `revenue-analytics-${new Date().toISOString().split('T')[0]}`;
        if (format === 'csv') {
          const headers = ['Date', 'Amount'];
          const rows = revenue.dailyRevenue.map((r) =>
            [r.date, r.amount].join(','),
          );
          csvContent = [headers.join(','), ...rows].join('\n');
        }
        break;
      }
      case 'subscriptions': {
        const subs = await this.getSubscriptionAnalytics(dateRange);
        rawData = subs;
        filename = `subscriptions-analytics-${new Date().toISOString().split('T')[0]}`;
        if (format === 'csv') {
          const headers = ['Date', 'Count'];
          const rows = subs.subscriptionGrowth.map((s) =>
            [s.date, s.count].join(','),
          );
          csvContent = [headers.join(','), ...rows].join('\n');
        }
        break;
      }
      default:
        throw new BadRequestException(`Invalid export type: ${type as string}`);
    }

    if (format === 'json') {
      return {
        data: rawData,
        contentType: 'application/json',
        filename: `${filename}.json`,
      };
    }

    return {
      data: csvContent,
      contentType: 'text/csv',
      filename: `${filename}.csv`,
    };
  }

  // =====================
  // USER SUSPENSION
  // =====================

  async suspendUser(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.isSuspended) {
      throw new BadRequestException('User is already suspended');
    }

    if (user.role === Role.admin) {
      throw new BadRequestException('Cannot suspend an admin user');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: true,
        suspendedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuspended: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
  }

  async unsuspendUser(userId: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!user.isSuspended) {
      throw new BadRequestException('User is not suspended');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: false,
        suspendedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuspended: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
  }

  async getDeletionRequests(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    // Filter for tickets with specific subject
    const where: Prisma.SupportTicketWhereInput = {
      subject: 'Delete Account Request',
      isDeleted: false,
    };

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    const parsedTickets = tickets.map((ticket) => {
      const message = ticket.message || '';

      // Extract reasons
      const reasonsMatch = message.match(/Reasons: (.*?)(\n|$)/);
      const reasonsString = reasonsMatch ? reasonsMatch[1] : '';
      const reasons = reasonsString
        ? reasonsString
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
        : [];

      // Extract notes
      const notesMatch = message.match(/Notes: (.*?)(\n|$)/);
      const notes = notesMatch ? notesMatch[1].trim() : '';

      // Check if permanent
      const isPermanent = message.includes(PERMANENT_DELETION_MSG);

      return {
        id: ticket.id,
        userId: ticket.userId,
        userEmail: ticket.user.email,
        userName: ticket.user.name,
        reasons,
        notes,
        createdAt: ticket.createdAt,
        status: ticket.status,
        isPermanent,
      };
    });

    return {
      data: parsedTickets,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
