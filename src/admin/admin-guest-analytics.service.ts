import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
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
  IAdminActivityRepository,
  ADMIN_ACTIVITY_REPOSITORY,
  IAdminAnalyticsRepository,
  ADMIN_ANALYTICS_REPOSITORY,
} from './repositories';

@Injectable()
export class AdminGuestAnalyticsService {
  constructor(
    @Inject(ADMIN_ACTIVITY_REPOSITORY)
    private readonly activityRepo: IAdminActivityRepository,
    @Inject(ADMIN_ANALYTICS_REPOSITORY)
    private readonly analyticsRepo: IAdminAnalyticsRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

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
