import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  DashboardStatsDto,
  UserGrowthDto,
  StoryStatsDto,
  ContentBreakdownDto,
  SystemHealthDto,
  PaginatedResponseDto,
  SubscriptionAnalyticsDto,
  RevenueAnalyticsDto,
  ActivityLogDto,
  AiCreditAnalyticsDto,
  UserGrowthMonthlyDto,
} from './dto/admin-responses.dto';
import { UserFilterDto, DateRangeDto } from './dto/admin-filters.dto';
import {
  CreateAdminDto,
  UpdateUserDto,
  BulkActionDto,
} from './dto/user-management.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';
import {
  categories,
  themes,
  defaultAgeGroups,
  systemAvatars,
} from '../prisma/seed-data';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CACHE_KEYS,
  STORY_INVALIDATION_KEYS,
} from '@/shared/constants/cache-keys.constants';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { BatchedBroadcastNotificationDto } from './dto/batched-broadcast-notification.dto';
import {
  NotificationService,
  BatchedBroadcastSummary,
} from '../notification/notification.service';
import { ResetQuotaDto } from './dto/reset-quota.dto';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { GuestStatsDto, GuestActivityFilterDto } from './dto/guest-stats.dto';
import { VerifyPurchaseDto } from '../payment/dto/verify-purchase.dto';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminUserService } from './admin-user.service';
import { AdminCouponService } from './admin-coupon.service';
import { AdminExportService } from './admin-export.service';
import { AdminSubscriptionOpsService } from './admin-subscription-ops.service';
import {
  IAdminStoryRepository,
  ADMIN_STORY_REPOSITORY,
  IAdminContentRepository,
  ADMIN_CONTENT_REPOSITORY,
} from './repositories';

/**
 * Facade for admin operations. Public methods called by AdminController are
 * preserved 1:1; cohesive concern-groups are delegated to focused services
 * (analytics, user management, coupons, exports, subscription ops), while
 * story moderation, database seeding and broadcast notifications remain here
 * and route all persistence through the admin repositories.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly eventEmitter: EventEmitter2,
    private readonly analyticsService: AdminAnalyticsService,
    private readonly userService: AdminUserService,
    private readonly couponService: AdminCouponService,
    private readonly exportService: AdminExportService,
    private readonly subscriptionOpsService: AdminSubscriptionOpsService,
    // NotificationModule is @Global, so no admin.module import change is needed.
    private readonly notificationService: NotificationService,
    @Inject(ADMIN_STORY_REPOSITORY)
    private readonly storyRepo: IAdminStoryRepository,
    @Inject(ADMIN_CONTENT_REPOSITORY)
    private readonly contentRepo: IAdminContentRepository,
  ) {}

  // =====================
  // DASHBOARD / ANALYTICS
  // =====================

  getDashboardStats(): Promise<DashboardStatsDto> {
    return this.analyticsService.getDashboardStats();
  }

  getUserGrowth(dateRange: DateRangeDto): Promise<UserGrowthDto[]> {
    return this.analyticsService.getUserGrowth(dateRange);
  }

  getStoryStats(): Promise<StoryStatsDto> {
    return this.analyticsService.getStoryStats();
  }

  getContentBreakdown(): Promise<ContentBreakdownDto> {
    return this.analyticsService.getContentBreakdown();
  }

  getSystemHealth(): Promise<SystemHealthDto> {
    return this.analyticsService.getSystemHealth();
  }

  getSubscriptionAnalytics(
    dateRange?: DateRangeDto,
  ): Promise<SubscriptionAnalyticsDto> {
    return this.analyticsService.getSubscriptionAnalytics(dateRange);
  }

  getRevenueAnalytics(dateRange?: DateRangeDto): Promise<RevenueAnalyticsDto> {
    return this.analyticsService.getRevenueAnalytics(dateRange);
  }

  getAiCreditAnalytics(
    duration:
      | 'yearly'
      | 'quarterly'
      | 'monthly'
      | 'weekly'
      | 'daily' = 'yearly',
  ): Promise<AiCreditAnalyticsDto> {
    return this.analyticsService.getAiCreditAnalytics(duration);
  }

  getUserGrowthMonthly(
    duration: 'last_year' | 'last_month' | 'last_week' = 'last_year',
  ): Promise<{ data: UserGrowthMonthlyDto }> {
    return this.analyticsService.getUserGrowthMonthly(duration);
  }

  getSystemLogs(
    level?: string,
    limit: number = 100,
  ): Promise<ActivityLogDto[]> {
    return this.analyticsService.getSystemLogs(level, limit);
  }

  getGuestStats(): Promise<GuestStatsDto> {
    return this.analyticsService.getGuestStats();
  }

  getGuestActivity(filters: GuestActivityFilterDto) {
    return this.analyticsService.getGuestActivity(filters);
  }

  // =====================
  // USER MANAGEMENT
  // =====================

  getAllUsers(filters: UserFilterDto): Promise<PaginatedResponseDto<any>> {
    return this.userService.getAllUsers(filters);
  }

  getUserById(userId: string): Promise<any> {
    return this.userService.getUserById(userId);
  }

  createAdmin(data: CreateAdminDto): Promise<any> {
    return this.userService.createAdmin(data);
  }

  updateUser(
    userId: string,
    data: UpdateUserDto,
    currentAdminId?: string,
  ): Promise<any> {
    return this.userService.updateUser(userId, data, currentAdminId);
  }

  deleteUser(
    userId: string,
    permanent: boolean = false,
    currentAdminId?: string,
  ): Promise<any> {
    return this.userService.deleteUser(userId, permanent, currentAdminId);
  }

  restoreUser(userId: string): Promise<any> {
    return this.userService.restoreUser(userId);
  }

  bulkUserAction(data: BulkActionDto): Promise<{ count: number }> {
    return this.userService.bulkUserAction(data);
  }

  suspendUser(userId: string): Promise<any> {
    return this.userService.suspendUser(userId);
  }

  unsuspendUser(userId: string): Promise<any> {
    return this.userService.unsuspendUser(userId);
  }

  resetUserQuota(userId: string, body: ResetQuotaDto) {
    return this.userService.resetUserQuota(userId, body);
  }

  // =====================
  // STORY MANAGEMENT
  // =====================

  async getStoryById(storyId: string): Promise<any> {
    const story = await this.storyRepo.findStoryById(storyId);

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
    const story = await this.storyRepo.findStoryBasicById(storyId);

    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    const result = await this.storyRepo.updateStoryRecommendation({
      storyId,
      recommended: !story.recommended,
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
    const story = await this.storyRepo.findStoryBasicById(storyId);

    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    let result;
    if (permanent) {
      result = await this.storyRepo.hardDeleteStory(storyId);
    } else {
      result = await this.storyRepo.softDeleteStory(storyId);
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
  // SUBSCRIPTION & REVENUE ANALYTICS -> AdminAnalyticsService (above)
  // =====================

  // =====================
  // SEED DATABASE
  // =====================

  async seedDatabase(): Promise<{ message: string }> {
    try {
      // Seed categories
      this.logger.log('Seeding categories...');
      for (const category of categories) {
        await this.contentRepo.seedCategoryByFind(category);
      }

      // Seed themes
      this.logger.log('Seeding themes...');
      for (const theme of themes) {
        await this.contentRepo.seedTheme(theme);
      }

      // Seed age groups
      this.logger.log('Seeding age groups...');
      for (const ageGroup of defaultAgeGroups) {
        await this.contentRepo.seedAgeGroup(ageGroup);
      }

      // Seed system avatars
      this.logger.log('Seeding system avatars...');
      for (const avatarData of systemAvatars) {
        await this.contentRepo.seedSystemAvatarWithFlags(avatarData);
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
  // EXPORT ENDPOINTS
  // =====================

  exportUsersAsCsv(filters: UserFilterDto): Promise<string> {
    return this.exportService.exportUsersAsCsv(filters);
  }

  exportAnalyticsData(
    type: 'users' | 'revenue' | 'subscriptions',
    format: 'csv' | 'json' = 'csv',
    startDate?: string,
    endDate?: string,
  ): Promise<{ data: any; contentType: string; filename: string }> {
    return this.exportService.exportAnalyticsData(
      type,
      format,
      startDate,
      endDate,
    );
  }

  // =====================
  // COUPONS
  // =====================

  createCoupon(dto: CreateCouponDto) {
    return this.couponService.createCoupon(dto);
  }

  listCoupons(page: number, limit: number, isActive?: boolean) {
    return this.couponService.listCoupons(page, limit, isActive);
  }

  getCouponById(id: string) {
    return this.couponService.getCouponById(id);
  }

  updateCoupon(id: string, dto: UpdateCouponDto) {
    return this.couponService.updateCoupon(id, dto);
  }

  deleteCoupon(id: string) {
    return this.couponService.deleteCoupon(id);
  }

  validateCoupon(code: string, plan?: string) {
    return this.couponService.validateCoupon(code, plan);
  }

  redeemCoupon(code: string, userId: string) {
    return this.couponService.redeemCoupon(code, userId);
  }

  // =====================
  // BROADCAST NOTIFICATIONS
  // =====================

  /**
   * Broadcast a push notification to all users via FCM topic.
   * Emits a 'notification.broadcast' event handled by the notification module.
   */
  async broadcastNotification(
    dto: BroadcastNotificationDto,
  ): Promise<{ sent: boolean; topic: string; inAppDelivered: number }> {
    // The env-scoped broadcast topic (all_users_<NODE_ENV>) for THIS backend.
    const scopedTopic = this.notificationService.getBroadcastTopic();

    // Isolation guard: an admin may omit `topic` (uses the env-scoped default),
    // but may NOT target the legacy global `all_users` or another environment's
    // `all_users_<env>` topic — the Firebase project is shared, so that would
    // bleed the broadcast across dev/staging/prod. Only this env's topic is
    // permitted; anything else is rejected rather than silently coerced.
    if (dto.topic && dto.topic !== scopedTopic) {
      throw new BadRequestException(
        `Broadcast topic "${dto.topic}" is not allowed. Omit "topic" to use this ` +
          `environment's topic ("${scopedTopic}"); cross-environment and legacy ` +
          `topics are blocked to prevent cross-environment push bleed.`,
      );
    }
    const topic = scopedTopic;

    await this.eventEmitter.emitAsync('notification.broadcast', {
      topic,
      title: dto.title,
      body: dto.body,
      data: dto.data,
    });
    this.logger.log(
      `Broadcast notification emitted to topic "${topic}": "${dto.title}"`,
    );

    // Also write an in-app inbox entry for every user so the broadcast shows in
    // the app's notification list, not just as an ephemeral push.
    let inAppDelivered = 0;
    try {
      const inApp = await this.notificationService.broadcastInAppToAllUsers(
        dto.title,
        dto.body,
        dto.data,
      );
      inAppDelivered = inApp.delivered;
    } catch (error) {
      this.logger.error(
        `In-app broadcast failed for "${dto.title}": ${(error as Error).message}`,
      );
    }

    return { sent: true, topic, inAppDelivered };
  }

  /**
   * Broadcast a push notification to all users by fanning out to every active
   * device token in staggered batches (<= 500 tokens per FCM multicast call),
   * instead of a single topic push. Emits a 'notification.broadcast-batched'
   * event handled by the notification module and returns its summary.
   */
  async broadcastNotificationBatched(
    dto: BatchedBroadcastNotificationDto,
  ): Promise<BatchedBroadcastSummary> {
    const results = await this.eventEmitter.emitAsync(
      'notification.broadcast-batched',
      {
        title: dto.title,
        body: dto.body,
        data: dto.data,
        batchSize: dto.batchSize,
        intervalSeconds: dto.intervalSeconds,
      },
    );

    const summary = results.find(
      (r): r is BatchedBroadcastSummary =>
        !!r && typeof r === 'object' && 'batches' in r,
    );

    // The notification module registers exactly one listener for this event; a
    // missing summary means the listener didn't run (misconfiguration), so fail
    // loudly rather than reporting a false "0 devices" success.
    if (!summary) {
      throw new InternalServerErrorException(
        'Batched broadcast produced no summary; notification listener may not be registered',
      );
    }

    this.logger.log(
      `Batched broadcast emitted: "${dto.title}" -> ${summary.totalDevices} device(s) in ${summary.batches} batch(es)`,
    );

    return summary;
  }

  /**
   * Seed all existing device tokens to a topic.
   * Emits a 'notification.seed-topic' event.
   */
  async seedTopicSubscriptions(
    topic: string = this.notificationService.getBroadcastTopic(),
  ): Promise<{ emitted: boolean }> {
    if (!/^[a-zA-Z0-9\-_.~%]+$/.test(topic)) {
      throw new BadRequestException(
        'Invalid topic name: must contain only valid FCM topic characters',
      );
    }
    // Isolation guard (mirrors broadcast): only this environment's topic may be
    // seeded, so an admin can't re-subscribe every device back onto the legacy
    // global `all_users` (or another env's topic) and re-open the bleed.
    const scopedTopic = this.notificationService.getBroadcastTopic();
    if (topic !== scopedTopic) {
      throw new BadRequestException(
        `Seed topic "${topic}" is not allowed. Omit "topic" to seed this ` +
          `environment's topic ("${scopedTopic}"); cross-environment and legacy ` +
          `topics are blocked.`,
      );
    }
    try {
      await this.eventEmitter.emitAsync('notification.seed-topic', { topic });
      this.logger.log(`Topic seed event emitted for topic: ${topic}`);
      return { emitted: true };
    } catch (err) {
      this.logger.error(
        `Seed-topic subscription failed for "${topic}": ${(err as Error).message}`,
      );
      throw err;
    }
  }

  // =====================
  // SUBSCRIPTION ACTIVATION / PURCHASE VERIFICATION
  // =====================

  activateSubscription(
    userId: string,
    dto: ActivateSubscriptionDto,
    adminUserId: string,
  ) {
    return this.subscriptionOpsService.activateSubscription(
      userId,
      dto,
      adminUserId,
    );
  }

  verifyUserPurchase(userId: string, dto: VerifyPurchaseDto) {
    return this.subscriptionOpsService.verifyUserPurchase(userId, dto);
  }
}
