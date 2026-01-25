import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviders } from '../common/constants/ai-providers.constants';
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
  UserDetailDto,
  StoryDetailDto,
  CategoryDto,
  ThemeDto,
  SubscriptionDto,
  ActivityLogDto,
  AiCreditAnalyticsDto,
  UserGrowthMonthlyDto,
} from './dto/admin-responses.dto';
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
import { categories, themes, defaultAgeGroups, systemAvatars } from '../../prisma/data';

import { VoiceService } from '../voice/voice.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly voiceService: VoiceService,
  ) { }

  // =====================
  // DASHBOARD STATISTICS
  // =====================

  async getDashboardStats(): Promise<DashboardStatsDto> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(
      now.getTime() - now.getDay() * 24 * 60 * 60 * 1000,
    );
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get all users first
    const allUsers = await this.prisma.user.findMany({
      where: { isDeleted: false },
      include: {
        subscriptions: {
          where: {
            status: 'active',
            endsAt: { gt: now }, // Subscription hasn't expired
          },
        },
      },
    });

    // Calculate paid users (users with active subscriptions)
    const paidUsers = allUsers.filter(user =>
      user.subscriptions.length > 0 &&
      user.subscriptions.some(sub => sub.status === 'active' && (!sub.endsAt || sub.endsAt > now))
    ).length;

    // Calculate unpaid users
    const totalUsers = allUsers.length;
    const unpaidUsers = totalUsers - paidUsers;

    const [
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
      totalStoryProgress,
      totalFavorites,
      totalSubscriptions,
      activeSubscriptions,
      totalRevenue,
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
        where: {
          updatedAt: { gte: twentyFourHoursAgo },
          isDeleted: false,
        },
      }),
      this.prisma.user.count({
        where: {
          updatedAt: { gte: sevenDaysAgo },
          isDeleted: false,
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: startOfToday },
          isDeleted: false,
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: startOfWeek },
          isDeleted: false,
        },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: startOfMonth },
          isDeleted: false,
        },
      }),
      this.prisma.storyProgress.count(),
      this.prisma.favorite.count(),
      this.prisma.subscription.count(),
      this.prisma.subscription.count({
        where: {
          status: 'active',
          OR: [
            { endsAt: null },
            { endsAt: { gt: now } }
          ],
        },
      }),
      // Calculate total revenue from successful payment transactions
      this.prisma.paymentTransaction.aggregate({
        where: {
          status: 'success',
        },
        _sum: {
          amount: true,
        },
      }).then(result => result._sum.amount || 0),
    ]);

    // Calculate average session time
    const recentSessions = await this.prisma.screenTimeSession.findMany({
      where: {
        endTime: { not: null },
        startTime: { gte: sevenDaysAgo },
      },
      select: {
        duration: true,
      },
    });

    const avgSessionTime = recentSessions.length > 0
      ? recentSessions.reduce((sum, session) => sum + (session.duration || 0), 0) / recentSessions.length
      : 0;

    // Get subscription plan breakdown
    const subscriptionPlans = await this.prisma.subscription.groupBy({
      by: ['plan'],
      where: {
        status: 'active',
        OR: [
          { endsAt: null },
          { endsAt: { gt: now } }
        ],
      },
      _count: true,
    });

    // --- TREND ANALYTICS CALCULATION ---
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Helpers for trend calculation
    const getCountTrend = async (model: any, whereClauseFn: (start: Date, end: Date) => any) => {
      const current = await model.count({
        where: whereClauseFn(startOfMonth, now),
      });
      const previous = await model.count({
        where: whereClauseFn(lastMonthStart, lastMonthEnd),
      });
      return {
        count: current,
        trendPercent: this.calculateTrendPercentage(current, previous),
        timeframe: 'vs last month',
      };
    };

    // 1. New Users Trend
    const newUsersMetric = await getCountTrend(this.prisma.user, (start, end) => ({
      createdAt: { gte: start, lte: end },
      isDeleted: false,
    }));

    // 2. Total Users Trend (Calculated differently as it's a snapshot)
    // New Users Last Month for calculation
    const newUsersLastMonth = await this.prisma.user.count({
      where: {
        createdAt: { gte: lastMonthStart, lte: lastMonthEnd },
        isDeleted: false,
      },
    });
    const totalUsersLastMonthEnd = totalUsers - newUsersMetric.count;
    const totalUsersTrend = this.calculateTrendPercentage(totalUsers, totalUsersLastMonthEnd);

    // 3. Active Users Trend (MAU)
    const activeUsersMetric = await getCountTrend(this.prisma.user, (start, end) => ({
      updatedAt: { gte: start, lte: end },
      isDeleted: false,
    }));

    // 4. Revenue Trend
    const getRevenue = async (start: Date, end: Date) => {
      const result = await this.prisma.paymentTransaction.aggregate({
        where: { createdAt: { gte: start, lte: end }, status: 'success' },
        _sum: { amount: true },
      });
      return result._sum.amount || 0;
    };
    const revenueThisMonth = await getRevenue(startOfMonth, now);
    const revenueLastMonth = await getRevenue(lastMonthStart, lastMonthEnd);

    const revenueMetric = {
      count: Number(revenueThisMonth.toFixed(2)),
      trendPercent: this.calculateTrendPercentage(revenueThisMonth, revenueLastMonth),
      timeframe: 'vs last month',
    };

    // 5. Active Subscriptions Trend
    // Using the proxy logic from before: New Subscriptions as activity momentum
    const activeSubsMetric = await getCountTrend(this.prisma.subscription, (start, end) => ({
      startedAt: { gte: start, lte: end }
    }));
  
    const paidUsers30dAgo = await this.prisma.subscription.count({
      where: {
        startedAt: { lte: lastMonthEnd },
        OR: [{ endsAt: null }, { endsAt: { gt: lastMonthEnd } }]
      }
    });

    const activeSubscriptionsMetric = {
      count: activeSubscriptions,
      trendPercent: this.calculateTrendPercentage(activeSubscriptions, paidUsers30dAgo),
      timeframe: 'vs last month'
    };

    // 6. Total Stories Trend
    // New Stories Count for trend calculation info
    const newStoriesThisMonth = await this.prisma.story.count({ where: { createdAt: { gte: startOfMonth } } });
    const totalStoriesLastMonthEnd = totalStories - newStoriesThisMonth;

    const totalStoriesMetric = {
      count: totalStories,
      trendPercent: this.calculateTrendPercentage(totalStories, totalStoriesLastMonthEnd),
      timeframe: 'vs last month'
    };

    // 7. Unpaid Users
    const unpaidUsers30dAgo = totalUsersLastMonthEnd - paidUsers30dAgo;

    const unpaidUsersMetric = {
      count: unpaidUsers,
      trendPercent: this.calculateTrendPercentage(unpaidUsers, unpaidUsers30dAgo),
      timeframe: 'vs last month'
    };

    return {
      totalUsers,
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
      activeSubscriptions,
      subscriptionPlans: subscriptionPlans.map(plan => ({
        plan: plan.plan,
        count: plan._count,
      })),
      totalRevenue: Number(totalRevenue.toFixed(2)),
      conversionRate: totalUsers > 0 ? Number(((paidUsers / totalUsers) * 100).toFixed(2)) : 0,
      performanceMetrics: {
        newUsers: newUsersMetric,
        totalUsers: {
          count: totalUsers,
          trendPercent: totalUsersTrend,
          timeframe: 'vs last month',
        },
        activeUsers: activeUsersMetric,
        revenue: revenueMetric,
        activeSubscriptions: activeSubscriptionsMetric,
        totalStories: totalStoriesMetric,
        unpaidUsers: unpaidUsersMetric
      }
    };
  }

  private calculateTrendPercentage(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
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

    return {
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
      const wantsActiveSubscription = hasActiveSub === true || String(hasActiveSub) === 'true';

      const activeSubscriptionCriteria = {
        status: 'active',
        isDeleted: false,
        OR: [
          { endsAt: null },
          { endsAt: { gt: now } }
        ]
      };

      if (wantsActiveSubscription) {
        where.subscriptions = {
          some: activeSubscriptionCriteria
        };
      } else {
        where.NOT = {
          subscriptions: {
            some: activeSubscriptionCriteria
          }
        };
      }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          subscriptions: {
            where: {
              status: 'active',
              isDeleted: false,
              OR: [
                { endsAt: null },
                { endsAt: { gt: new Date() } }
              ],
            },
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
              subscriptions: true,
              paymentTransactions: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map(user => {
        // Sanitize user object
        const { passwordHash, pinHash, kids, paymentTransactions, usage, subscriptions, ...safeUser } = user;

        // Calculate metrics
        const creditUsed = user.usage?.elevenLabsCount || 0;
        const activityLength = user.kids.reduce(
          (total, kid) => total + kid.screenTimeSessions.reduce((sum, s) => sum + (s.duration || 0), 0),
          0
        );
        const amountSpent = user.paymentTransactions.reduce((sum, txn) => sum + txn.amount, 0);

        return {
          ...safeUser,
          registrationDate: user.createdAt,
          activityLength,
          creditUsed,
          amountSpent,
          isPaidUser: user.subscriptions.length > 0,
          activeSubscription: user.subscriptions[0] || null,
          kidsCount: user._count.kids,
          sessionsCount: user._count.auth,
          favoritesCount: user._count.parentFavorites,
          subscriptionsCount: user._count.subscriptions,
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
        subscriptions: {
          orderBy: { startedAt: 'desc' },
        },
        paymentTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            auth: true,
            parentFavorites: true,
            voices: true,
            subscriptions: true,
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
    const hasActiveSubscription = user.subscriptions.some(sub =>
      sub.status === 'active' && (!sub.endsAt || sub.endsAt > now)
    );

    const totalSpentResult = await this.prisma.paymentTransaction.aggregate({
      where: {
        userId: userId,
        status: 'success',
      },
      _sum: {
        amount: true,
      },
    });

    const { passwordHash, pinHash, ...safeUser } = user;

    return {
      ...safeUser,
      isPaidUser: hasActiveSubscription,
      totalSpent: totalSpentResult._sum.amount || 0,
      stats: {
        sessionsCount: user._count.auth,
        favoritesCount: user._count.parentFavorites,
        voicesCount: user._count.voices,
        subscriptionsCount: user._count.subscriptions,
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

  async updateUser(userId: string, data: UpdateUserDto, currentAdminId?: string): Promise<any> {
    // Safety check: prevent self-demotion
    if (userId === currentAdminId && data.role && data.role !== Role.admin) {
      throw new BadRequestException('You cannot demote yourself from admin status.');
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

  async deleteUser(userId: string, permanent: boolean = false, currentAdminId?: string): Promise<any> {
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
      case 'delete':
        const deleteResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        });
        return { count: deleteResult.count };

      case 'restore':
        const restoreResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isDeleted: false,
            deletedAt: null,
          },
        });
        return { count: restoreResult.count };

      case 'verify':
        const verifyResult = await this.prisma.user.updateMany({
          where: { id: { in: userIds } },
          data: {
            isEmailVerified: true,
          },
        });
        return { count: verifyResult.count };

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
      data: stories.map(story => ({
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

    return this.prisma.story.update({
      where: { id: storyId },
      data: { recommended: !story.recommended },
    });
  }

  async deleteStory(storyId: string, permanent: boolean = false): Promise<any> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    if (permanent) {
      return this.prisma.story.delete({ where: { id: storyId } });
    } else {
      return this.prisma.story.update({
        where: { id: storyId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    }
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

    return categories.map(cat => ({
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

    return themes.map(theme => ({
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

  async getSubscriptionAnalytics(dateRange?: DateRangeDto): Promise<SubscriptionAnalyticsDto> {
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate ? new Date(dateRange.endDate) : new Date();

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
          OR: [
            { endsAt: null },
            { endsAt: { gt: new Date() } }
          ],
        },
        _count: true,
      }),
    ]);

    // Calculate churn rate
    const churnRate = await this.calculateChurnRate(startDate, endDate);

    return {
      subscriptionGrowth: subscriptions.map(sub => ({
        date: sub.startedAt.toISOString().split('T')[0],
        count: sub._count,
      })),
      revenueGrowth: revenue.map(rev => ({
        date: rev.createdAt.toISOString().split('T')[0],
        amount: rev._sum.amount || 0,
      })),
      planBreakdown: planBreakdown.map(plan => ({
        plan: plan.plan,
        count: plan._count,
      })),
      churnRate,
    };
  }

  private async calculateChurnRate(startDate: Date, endDate: Date): Promise<number> {
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
            }
          }
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

  async getRevenueAnalytics(dateRange?: DateRangeDto): Promise<RevenueAnalyticsDto> {
    const startDate = dateRange?.startDate
      ? new Date(dateRange.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate ? new Date(dateRange.endDate) : new Date();

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

      allTransactions.forEach(transaction => {
        const date = new Date(transaction.createdAt);
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        const yearKey = date.getFullYear().toString();

        monthlyRevenueMap.set(monthKey, (monthlyRevenueMap.get(monthKey) || 0) + transaction.amount);
        yearlyRevenueMap.set(yearKey, (yearlyRevenueMap.get(yearKey) || 0) + transaction.amount);
      });

      const monthlyRevenue = Array.from(monthlyRevenueMap.entries()).map(([month, total]) => ({
        month,
        total_amount: total,
      }));

      const yearlyRevenue = Array.from(yearlyRevenueMap.entries()).map(([year, total]) => ({
        year,
        total_amount: total,
      }));

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

      const planRevenueMap = new Map<string, { subscription_count: number; total_revenue: number }>();

      subscriptionsWithRevenue.forEach(sub => {
        const current = planRevenueMap.get(sub.plan) || { subscription_count: 0, total_revenue: 0 };
        const userRevenue = sub.user.paymentTransactions.reduce((sum, t) => sum + t.amount, 0);

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
        dailyRevenue: dailyRevenue.map(day => ({
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
      console.log('📚 Seeding categories...');
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
      console.log('🎨 Seeding themes...');
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
      console.log('👶 Seeding age groups...');
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
      console.log('🖼️ Seeding system avatars...');
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

  async getAiCreditAnalytics(): Promise<AiCreditAnalyticsDto> {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);

    const logs = await this.prisma.activityLog.findMany({
      where: {
        action: 'AI_GENERATION',
        createdAt: { gte: startOfYear },
      },
    });

    // Helper to format month
    const getMonthKey = (d: Date) => d.toLocaleString('default', { month: 'short' });
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Initialize map
    const dataMap = new Map<string, { elevenLabs: number; gemini: number; total: number }>();
    months.forEach(m => dataMap.set(m, { elevenLabs: 0, gemini: 0, total: 0 }));

    logs.forEach(log => {
      const month = getMonthKey(log.createdAt);
      if (!dataMap.has(month)) return; // Should allow current year only

      let credits = 1;
      let provider = '';
      try {
        const details = JSON.parse(log.details || '{}');
        credits = details.credits || 1;
        provider = details.provider || '';
      } catch (e) {
        // Fallback
      }

      const entry = dataMap.get(month)!;
      if (provider === AiProviders.ElevenLabs) entry.elevenLabs += credits;
      if (provider === AiProviders.Gemini) entry.gemini += credits;
      entry.total += credits;
    });

    const yearly = months.map(m => ({
      month: m,
      ...dataMap.get(m)!,
    }));

    return { yearly };
  }

  async getAiCreditBalance() {
    return this.voiceService.getProviderSubscriptionInfo();
  }

  // =====================
  // CUSTOM USER ANALYTICS
  // =====================

  async getUserGrowthMonthly(): Promise<UserGrowthMonthlyDto> {
    const now = new Date();
    // 12 months ago from 1st of current month
    const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1); // Go back 11 months + current = 12

    const users = await this.prisma.user.findMany({
      where: {
        createdAt: { gte: startDate },
        isDeleted: false,
      },
      select: { createdAt: true, id: true, subscriptions: { where: { status: 'active' } } }
    });

    const getMonthLabel = (d: Date) => {
      return d.toLocaleString('default', { month: 'short' });
    };

    // Generate last 12 month labels
    const labels: string[] = [];
    const d = new Date(startDate);
    while (d <= now) {
      labels.push(getMonthLabel(d));
      d.setMonth(d.getMonth() + 1);
    }
    // De-dupe labels if 'now' pushes slightly into next month logic or loop edge case
    const uniqueLabels = [...new Set(labels)];

    // Buckets
    const freeCounts = new Array(uniqueLabels.length).fill(0);
    const paidCounts = new Array(uniqueLabels.length).fill(0);

    users.forEach(u => {
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
      }
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

    return activities.map(activity => ({
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

  async createBackup(): Promise<{ message: string; timestamp: Date }> {
    // Implement backup logic based on your database
    return { message: 'Backup created successfully', timestamp: new Date() };
  }

  async getSystemLogs(level?: string, limit: number = 100): Promise<ActivityLogDto[]> {
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

    return logs.map(log => ({
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

    return subscriptions.map(sub => ({
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
}