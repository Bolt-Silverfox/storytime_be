import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import * as nodemailer from 'nodemailer';
import { NotificationRegistry, Notifications } from './notification.registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationPreference,
  NotificationCategory as PrismaCategory,
  NotificationType as PrismaNotificationType,
} from '@prisma/client';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  BulkUpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from './dto/notification.dto';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import {
  INotificationProvider,
  NotificationPayload,
  NotificationResult,
} from './providers/notification-provider.interface';
import {
  EmailQueueService,
  QueuedEmailResult,
} from './queue/email-queue.service';
import { PushQueueService } from './queue/push-queue.service';
import {
  DeviceTokenResponseDto,
  DeviceTokenListResponseDto,
  DevicePlatform,
} from './dto/device-token.dto';

/** User-facing notification categories that can be toggled in settings. */
const USER_CONFIGURABLE_CATEGORIES: PrismaCategory[] = [
  PrismaCategory.NEW_STORY,
  PrismaCategory.STORY_FINISHED,
  PrismaCategory.ACHIEVEMENT_UNLOCKED,
  PrismaCategory.BADGE_EARNED,
  PrismaCategory.STREAK_MILESTONE,
  PrismaCategory.WE_MISS_YOU,
  PrismaCategory.INCOMPLETE_STORY_REMINDER,
  PrismaCategory.DAILY_LISTENING_REMINDER,
  PrismaCategory.SUBSCRIPTION_REMINDER,
];

/** Summary returned by a batched (staggered) broadcast run. */
export interface BatchedBroadcastSummary {
  /** Total de-duplicated active device tokens targeted. */
  totalDevices: number;
  /** Number of push jobs enqueued (one per chunk of <= batchSize tokens). */
  batches: number;
  /** Effective chunk size after clamping to [1, 500]. */
  batchSize: number;
  /** Delay (seconds) before the final batch fires: (batches - 1) * intervalSeconds. */
  estimatedDurationSeconds: number;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private transporter: nodemailer.Transporter;
  private providers: Map<string, INotificationProvider>;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
    private readonly inAppProvider: InAppProvider,
    private readonly emailProvider: EmailProvider,
    private readonly emailQueueService: EmailQueueService,
    private readonly pushProvider: PushProvider,
    private readonly pushQueueService: PushQueueService,
  ) {
    // Initialize legacy email transporter (for backward compatibility / sync sends)
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get('SMTP_PORT') || 587,
      secure: this.configService.get('SMTP_SECURE'),
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
      tls: {
        rejectUnauthorized: this.configService.get('NODE_ENV') === 'production',
      },
    });

    // Initialize provider registry
    this.providers = new Map<string, INotificationProvider>();
    this.providers.set('email', this.emailProvider);
    this.providers.set('in_app', this.inAppProvider);
    this.providers.set('push', this.pushProvider);
  }

  /**
   * Fan out a NewStory notification to every active user, batched by id cursor.
   * Each send goes through sendNotification so it respects the user's NEW_STORY
   * preference (opt-out) and writes both the in-app record and push. Best-effort:
   * one failure never aborts the batch. Meant to be fire-and-forget from the
   * story-create path.
   */
  async broadcastNewStoryToUsers(
    storyId: string,
    storyTitle: string,
  ): Promise<void> {
    const BATCH = 500;
    let cursor: string | undefined;
    let sent = 0;
    let failed = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { isDeleted: false, isSuspended: false },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) {
        break;
      }
      for (const user of users) {
        try {
          await this.sendNotification(
            'NewStory',
            { storyTitle, storyId },
            user.id,
          );
          sent++;
        } catch (error) {
          failed++;
          this.logger.warn(
            `NewStory send failed for user ${user.id.substring(0, 8)}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) {
        break;
      }
    }
    this.logger.log(
      `NewStory broadcast for story ${storyId}: ${sent} sent, ${failed} failed`,
    );
  }

  /**
   * Write an in-app inbox record for every active user (batched). Used by admin
   * broadcasts so an announcement lands in the in-app inbox, not just push.
   * Best-effort per user; category defaults to SYSTEM_ALERT.
   */
  async broadcastInAppToAllUsers(
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<{ delivered: number; failed: number }> {
    const BATCH = 500;
    // Max concurrent in-app sends per sub-chunk — keeps fan-out fast without
    // exhausting the DB connection pool.
    const BROADCAST_CONCURRENCY = 50;
    let cursor: string | undefined;
    let delivered = 0;
    let failed = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { isDeleted: false, isSuspended: false },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) {
        break;
      }
      // Fan out sends concurrently, but in bounded sub-chunks so a large page
      // can't open thousands of simultaneous DB/provider calls and exhaust the
      // connection pool.
      for (let i = 0; i < users.length; i += BROADCAST_CONCURRENCY) {
        const slice = users.slice(i, i + BROADCAST_CONCURRENCY);
        const results = await Promise.all(
          slice.map(async (user) => {
            try {
              const result = await this.inAppProvider.send({
                userId: user.id,
                category: PrismaCategory.SYSTEM_ALERT,
                title,
                body,
                data,
              });
              return result.success;
            } catch (error) {
              this.logger.warn(
                `In-app broadcast failed for user ${user.id.substring(0, 8)}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return false;
            }
          }),
        );
        for (const success of results) {
          if (success) {
            delivered++;
          } else {
            failed++;
          }
        }
      }
      cursor = users[users.length - 1].id;
      if (users.length < BATCH) {
        break;
      }
    }
    this.logger.log(
      `In-app broadcast "${title}": ${delivered} delivered, ${failed} failed`,
    );
    return { delivered, failed };
  }

  async sendNotification(
    type: Notifications,
    data: Record<string, unknown>,
    targetUserId?: string,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const notification = NotificationRegistry[type];
      if (!notification) {
        throw new Error(`Invalid notification type: ${type}`);
      }

      const err = notification.validate(data);
      if (err) {
        throw new Error(`Validation failed for ${type}: ${err}`);
      }

      const template = await notification.getTemplate(data);

      const payload: NotificationPayload = {
        userId: targetUserId || (data.userId as string),
        category: notification.category,
        title: notification.subject,
        body: template,
        data: data,
      };

      // Map legacy medium to new channel
      let channels: string[] = ['in_app', 'push'];
      if (notification.medium === 'email') {
        channels = ['email'];
      }

      // Filter channels based on user preferences
      const userId = payload.userId;
      if (userId) {
        const enabledChannels = await this.getEnabledChannels(
          userId,
          notification.category,
          channels,
        );
        channels = enabledChannels;
      }

      if (channels.length === 0) {
        this.logger.log(
          `Notification ${type} skipped for user ${userId} - all channels disabled`,
        );
        return { success: true, messageId: 'skipped' };
      }

      const results = await this.sendViaProvider(payload, channels);

      const success = results.some((r) => r.success);
      return {
        success,
        messageId: results.find((r) => r.messageId)?.messageId,
        error: results.find((r) => !r.success)?.error,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to send notification: ${errorMessage}`,
        errorStack,
      );
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Queue an email for async delivery with automatic retries.
   * This is the RECOMMENDED method for sending emails.
   *
   * @param email Recipient email address
   * @param subject Email subject
   * @param htmlContent Rendered HTML content
   * @param options Optional: userId, category for tracking and priority
   */
  async queueEmail(
    email: string,
    subject: string,
    htmlContent: string,
    options?: {
      userId?: string;
      category?: PrismaCategory;
      templateName?: string;
    },
  ): Promise<QueuedEmailResult> {
    return this.emailQueueService.queueEmail({
      userId: options?.userId || 'system',
      category: options?.category || PrismaCategory.SYSTEM_ALERT,
      to: email,
      subject,
      html: htmlContent,
      metadata: options?.templateName
        ? { templateName: options.templateName }
        : undefined,
    });
  }

  /**
   * Send email synchronously (bypasses queue).
   * Use sparingly - only when immediate delivery confirmation is required.
   * For most cases, use queueEmail() instead.
   *
   * @deprecated Prefer queueEmail() for reliability with automatic retries
   */
  async sendEmailSync(
    email: string,
    subject: string,
    htmlContent: string,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const mailOptions = {
        from: {
          name: this.configService.get('DEFAULT_SENDER_NAME'),
          address: this.configService.get('DEFAULT_SENDER_EMAIL'),
        },
        to: email,
        subject: subject,
        html: htmlContent,
      };
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`Email sent successfully to ${email}: ${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send email';
      this.logger.error(`Error sending email to ${email}:`, errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send email - now queues by default for reliability.
   * Returns immediately after queueing (non-blocking).
   *
   * @param email Recipient email address
   * @param subject Email subject
   * @param htmlContent Rendered HTML content
   * @param sync Set to true to send synchronously (not recommended)
   */
  async sendEmail(
    email: string,
    subject: string,
    htmlContent: string,
    sync: boolean = false,
  ): Promise<{
    success: boolean;
    messageId?: string;
    jobId?: string;
    error?: string;
  }> {
    if (sync) {
      return this.sendEmailSync(email, subject, htmlContent);
    }

    const result = await this.queueEmail(email, subject, htmlContent);
    return {
      success: result.queued,
      jobId: result.jobId,
      error: result.error,
    };
  }

  /**
   * Send notification via specified provider(s)
   * This is the new provider-based notification API
   * @param payload Notification payload
   * @param channels Array of channels to send through (email, in_app, push)
   */
  async sendViaProvider(
    payload: NotificationPayload,
    channels: string[] = ['in_app'],
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const channel of channels) {
      const provider = this.providers.get(channel);
      if (!provider) {
        this.logger.warn(`Provider for channel '${channel}' not found`);
        results.push({
          success: false,
          error: `Provider for channel '${channel}' not found`,
        });
        continue;
      }

      try {
        const result = await provider.send(payload);
        results.push(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;

        this.logger.error(
          `Failed to send via ${channel}: ${errorMessage}`,
          errorStack,
        );
        results.push({
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Get enabled channels for a user based on their notification preferences.
   * Uses opt-out model: if no preference exists, the channel is enabled by default.
   */
  private async getEnabledChannels(
    userId: string,
    category: PrismaCategory,
    requestedChannels: string[],
  ): Promise<string[]> {
    // Map string channels to NotificationType enum
    const channelToType: Record<string, PrismaNotificationType> = {
      email: PrismaNotificationType.email,
      push: PrismaNotificationType.push,
      in_app: PrismaNotificationType.in_app,
    };

    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        userId,
        category,
        type: {
          in: requestedChannels
            .map((c) => channelToType[c])
            .filter((t) => t !== undefined),
        },
        isDeleted: false,
      },
    });

    // Create a map of channel -> enabled status
    const prefMap = new Map<string, boolean>();
    for (const pref of preferences) {
      const channelName = Object.entries(channelToType).find(
        ([, v]) => v === pref.type,
      )?.[0];
      if (channelName) {
        prefMap.set(channelName, pref.enabled);
      }
    }

    // Filter channels: include if preference doesn't exist (opt-out) OR if enabled
    return requestedChannels.filter((channel) => {
      const enabled = prefMap.get(channel);
      return enabled === undefined || enabled === true;
    });
  }

  private toNotificationPreferenceDto(
    pref: NotificationPreference,
  ): NotificationPreferenceDto {
    return {
      id: pref.id,
      type: pref.type,
      category: pref.category,
      enabled: pref.enabled,
      userId: pref.userId ?? undefined,
      kidId: pref.kidId ?? undefined,
      createdAt: pref.createdAt,
      updatedAt: pref.updatedAt,
    };
  }

  async create(
    dto: CreateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    // Verify user or kid exists and is not soft deleted
    if (dto.userId) {
      const user = await this.prisma.user.findUnique({
        where: {
          id: dto.userId,
          isDeleted: false, // CANNOT CREATE PREFERENCES FOR SOFT DELETED USERS
        },
      });
      if (!user) throw new NotFoundException('User not found');
    }

    if (dto.kidId) {
      const kid = await this.prisma.kid.findUnique({
        where: {
          id: dto.kidId,
          isDeleted: false, // CANNOT CREATE PREFERENCES FOR SOFT DELETED KIDS
        },
      });
      if (!kid) throw new NotFoundException('Kid not found');
    }

    const pref = await this.prisma.notificationPreference.create({
      data: {
        type: dto.type,
        category: dto.category,
        enabled: dto.enabled,
        userId: dto.userId,
        kidId: dto.kidId,
      },
    });
    return this.toNotificationPreferenceDto(pref);
  }

  async update(
    id: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    const pref = await this.prisma.notificationPreference.update({
      where: {
        id,
        isDeleted: false, // CANNOT UPDATE SOFT DELETED PREFERENCES
      },
      data: dto,
    });
    return this.toNotificationPreferenceDto(pref);
  }

  async bulkUpdate(
    userId: string,
    dtos: BulkUpdateNotificationPreferenceDto[],
  ): Promise<NotificationPreferenceDto[]> {
    const ids = dtos.map((dto) => dto.id);

    // Verify all preferences belong to the requesting user
    const owned = await this.prisma.notificationPreference.findMany({
      where: { id: { in: ids }, userId, isDeleted: false },
      select: { id: true },
    });

    const ownedIds = new Set(owned.map((p) => p.id));
    const unauthorized = ids.filter((id) => !ownedIds.has(id));
    if (unauthorized.length > 0) {
      throw new NotFoundException(
        `Notification preferences not found: ${unauthorized.join(', ')}`,
      );
    }

    const updates = dtos.map((dto) =>
      this.prisma.notificationPreference.update({
        where: {
          id: dto.id,
          isDeleted: false,
        },
        data: { enabled: dto.enabled },
      }),
    );

    const results = await this.prisma.$transaction(updates);
    return results.map((pref) => this.toNotificationPreferenceDto(pref));
  }

  async getForUser(userId: string): Promise<NotificationPreferenceDto[]> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT GET PREFERENCES FOR SOFT DELETED USERS
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        userId,
        isDeleted: false, // EXCLUDE SOFT DELETED PREFERENCES
      },
    });
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getForKid(kidId: string): Promise<NotificationPreferenceDto[]> {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET PREFERENCES FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        kidId,
        isDeleted: false, // EXCLUDE SOFT DELETED PREFERENCES
      },
    });
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getById(id: string): Promise<NotificationPreferenceDto> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        id,
        isDeleted: false, // EXCLUDE SOFT DELETED PREFERENCES
      },
    });
    if (!pref) throw new NotFoundException('Notification preference not found');
    return this.toNotificationPreferenceDto(pref);
  }

  /**
   * Toggle a category preference for both in_app and push channels.
   * Used by the settings UI when the user toggles a category on/off.
   */
  async toggleCategoryPreference(
    userId: string,
    category: PrismaCategory,
    enabled: boolean,
  ): Promise<NotificationPreferenceDto[]> {
    if (!USER_CONFIGURABLE_CATEGORIES.includes(category)) {
      throw new BadRequestException(
        `Unknown or non-configurable notification category: "${category}"`,
      );
    }

    const channels: PrismaNotificationType[] = [
      PrismaNotificationType.in_app,
      PrismaNotificationType.push,
    ];

    const results: NotificationPreferenceDto[] = [];

    for (const type of channels) {
      const pref = await this.prisma.notificationPreference.upsert({
        where: {
          userId_category_type: {
            userId,
            category,
            type,
          },
        },
        create: {
          userId,
          category,
          type,
          enabled,
        },
        update: {
          enabled,
          isDeleted: false, // Restore if previously soft deleted
          deletedAt: null,
        },
      });
      results.push(this.toNotificationPreferenceDto(pref));
    }

    return results;
  }

  /**
   * Get user preferences in grouped format.
   * Returns a map of category -> {push: bool, in_app: bool}.
   */
  async getUserPreferencesGrouped(
    userId: string,
  ): Promise<Record<string, { push: boolean; in_app: boolean }>> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        userId,
        isDeleted: false,
      },
    });

    // Group by category with per-channel status
    const grouped: Record<string, { push: boolean; in_app: boolean }> = {};

    for (const pref of prefs) {
      if (!grouped[pref.category]) {
        grouped[pref.category] = {
          push: true, // Default to enabled
          in_app: true, // Default to enabled
        };
      }

      if (pref.type === PrismaNotificationType.push) {
        grouped[pref.category].push = pref.enabled;
      } else if (pref.type === PrismaNotificationType.in_app) {
        grouped[pref.category].in_app = pref.enabled;
      }
    }

    return grouped;
  }

  /**
   * Update user preferences in bulk. Each category update affects both push and in_app channels.
   * Example: { "NEW_STORY": true, "STORY_FINISHED": false }
   */
  async updateUserPreferences(
    userId: string,
    preferences: Record<string, boolean>,
  ): Promise<Record<string, { push: boolean; in_app: boolean }>> {
    // Only user-facing categories can be toggled; auth/system categories are excluded
    const allowedCategories = new Set<PrismaCategory>(
      USER_CONFIGURABLE_CATEGORIES,
    );
    for (const key of Object.keys(preferences)) {
      if (!allowedCategories.has(key as PrismaCategory)) {
        throw new BadRequestException(
          `Unknown or non-configurable notification category: "${key}"`,
        );
      }
    }

    const categories = Object.keys(preferences) as PrismaCategory[];
    const channels: PrismaNotificationType[] = [
      PrismaNotificationType.in_app,
      PrismaNotificationType.push,
    ];

    // Upsert preferences for each category + channel combination in a single transaction
    const upserts = categories.flatMap((category) => {
      const enabled = preferences[category];
      return channels.map((type) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_category_type: { userId, category, type } },
          create: { userId, category, type, enabled },
          update: { enabled, isDeleted: false, deletedAt: null },
        }),
      );
    });
    await this.prisma.$transaction(upserts);

    return this.getUserPreferencesGrouped(userId);
  }

  /**
   * Seed default notification preferences for a new user.
   * Creates preferences for all user-facing categories with enabled: true.
   * Called during user registration.
   */
  async seedDefaultPreferences(userId: string): Promise<void> {
    const userFacingCategories = USER_CONFIGURABLE_CATEGORIES;

    const channels: PrismaNotificationType[] = [
      PrismaNotificationType.in_app,
      PrismaNotificationType.push,
    ];

    const preferences = userFacingCategories.flatMap((category) =>
      channels.map((type) => ({
        userId,
        category,
        type,
        enabled: true,
      })),
    );

    // Use createMany with skipDuplicates to avoid errors if preferences already exist
    await this.prisma.notificationPreference.createMany({
      data: preferences,
      skipDuplicates: true,
    });

    this.logger.log(
      `Seeded ${preferences.length} default preferences for user ${userId}`,
    );
  }

  /**
   * Soft delete or permanently delete a notification preference
   * @param id Notification preference ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async delete(id: string, permanent: boolean = false): Promise<void> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        id,
        isDeleted: false, // CANNOT DELETE ALREADY DELETED PREFERENCES
      },
    });

    if (!pref) {
      throw new NotFoundException('Notification preference not found');
    }

    if (permanent) {
      await this.prisma.notificationPreference.delete({
        where: { id },
      });
    } else {
      await this.prisma.notificationPreference.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    }
  }

  /**
   * Restore a soft deleted notification preference
   * @param id Notification preference ID
   */
  async getInAppNotifications(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    unreadOnly: boolean = false,
  ) {
    const where: { userId: string; isDeleted: boolean; isRead?: boolean } = {
      userId,
      isDeleted: false,
    };

    if (unreadOnly) {
      where.isRead = false;
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      notifications: notifications.map((n) => ({
        ...n,
        category: n.category,
      })),
      total,
    };
  }

  async markAsRead(userId: string, notificationIds: string[]) {
    return this.prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId,
      },
      data: {
        isRead: true,
      },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
  }

  async undoDelete(id: string): Promise<NotificationPreferenceDto> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { id },
    });

    if (!pref) {
      throw new NotFoundException('Notification preference not found');
    }

    if (!pref.isDeleted) {
      throw new BadRequestException('Notification preference is not deleted');
    }

    const restored = await this.prisma.notificationPreference.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });

    return this.toNotificationPreferenceDto(restored);
  }

  // ============================================
  // Device Token Management
  // ============================================

  /**
   * Register a device token for push notifications.
   * If the token already exists for this user, update it.
   * If the token exists for a different user, reassign it.
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
    deviceName?: string,
  ): Promise<DeviceTokenResponseDto> {
    // Validate platform enum
    if (!Object.values(DevicePlatform).includes(platform)) {
      throw new BadRequestException(
        `Invalid platform. Must be one of: ${Object.values(DevicePlatform).join(', ')}`,
      );
    }

    // Check if token exists
    const existingToken = await this.prisma.deviceToken.findUnique({
      where: { token },
    });

    if (existingToken) {
      // If same user, just update
      if (existingToken.userId === userId) {
        const updated = await this.prisma.deviceToken.update({
          where: { token },
          data: {
            platform,
            deviceName,
            isActive: true,
            isDeleted: false,
            deletedAt: null,
          },
        });
        this.logger.log(`Updated device token for user ${userId}`);
        // Re-subscribe to all_users topic (best-effort; don't fail token save on FCM side effects)
        this.pushProvider
          .subscribeToTopic([token], 'all_users')
          .catch((err) =>
            this.logger.warn(
              `Failed to subscribe updated token to all_users: ${(err as Error).message}`,
            ),
          );
        return this.toDeviceTokenResponse(updated);
      }

      // Different user - reassign the token
      const updated = await this.prisma.deviceToken.update({
        where: { token },
        data: {
          userId,
          platform,
          deviceName,
          isActive: true,
          isDeleted: false,
          deletedAt: null,
        },
      });
      this.logger.log(
        `Reassigned device token from user ${existingToken.userId} to ${userId}`,
      );
      // Subscribe reassigned token to all_users topic (best-effort)
      this.pushProvider
        .subscribeToTopic([token], 'all_users')
        .catch((err) =>
          this.logger.warn(
            `Failed to subscribe reassigned token to all_users: ${(err as Error).message}`,
          ),
        );
      return this.toDeviceTokenResponse(updated);
    }

    // Collect old tokens before deactivating (for FCM topic unsubscribe)
    let oldTokenStrings: string[] = [];
    if (deviceName) {
      const oldTokens = await this.prisma.deviceToken.findMany({
        where: {
          userId,
          platform,
          deviceName,
          isDeleted: false,
          token: { not: token },
        },
        select: { token: true },
      });
      oldTokenStrings = oldTokens.map((t) => t.token);
    }

    // Deactivate old tokens and create new one atomically
    const newToken = await this.prisma.$transaction(async (tx) => {
      if (deviceName) {
        await tx.deviceToken.updateMany({
          where: {
            userId,
            platform,
            deviceName,
            isDeleted: false,
            token: { not: token },
          },
          data: { isActive: false, isDeleted: true, deletedAt: new Date() },
        });
      }
      return tx.deviceToken.create({
        data: {
          userId,
          token,
          platform,
          deviceName,
        },
      });
    });
    this.logger.log(`Registered new device token for user ${userId}`);

    // Best-effort unsubscribe old tokens from broadcast topic
    if (oldTokenStrings.length > 0) {
      this.pushProvider
        .unsubscribeFromTopic(oldTokenStrings, 'all_users')
        .catch((err) =>
          this.logger.warn(
            `Failed to unsubscribe old tokens from all_users: ${(err as Error).message}`,
          ),
        );
    }

    // Subscribe the new token to the all_users topic (best-effort; don't fail registration on FCM side effects)
    this.pushProvider
      .subscribeToTopic([token], 'all_users')
      .catch((err) =>
        this.logger.warn(
          `Failed to subscribe new token to all_users: ${(err as Error).message}`,
        ),
      );

    return this.toDeviceTokenResponse(newToken);
  }

  /**
   * Get all active devices for a user.
   */
  async getUserDevices(userId: string): Promise<DeviceTokenListResponseDto> {
    const devices = await this.prisma.deviceToken.findMany({
      where: {
        userId,
        isActive: true,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      devices: devices.map((d) => this.toDeviceTokenResponse(d)),
      total: devices.length,
    };
  }

  /**
   * Unregister a device token (soft delete).
   */
  async unregisterDeviceToken(userId: string, token: string): Promise<void> {
    const deviceToken = await this.prisma.deviceToken.findFirst({
      where: {
        userId,
        token,
        isDeleted: false,
      },
    });

    if (!deviceToken) {
      throw new NotFoundException('Device token not found');
    }

    await this.prisma.deviceToken.update({
      where: { id: deviceToken.id },
      data: {
        isActive: false,
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    // Best-effort unsubscribe from broadcast topic
    this.pushProvider
      .unsubscribeFromTopic([token], 'all_users')
      .catch((err) =>
        this.logger.warn(
          `Failed to unsubscribe token from all_users: ${(err as Error).message}`,
        ),
      );

    this.logger.log(`Unregistered device token for user ${userId}`);
  }

  /**
   * Send a test push notification to verify setup.
   */
  async sendTestPush(
    userId: string,
    title: string,
    body: string,
    specificToken?: string,
  ): Promise<NotificationResult> {
    this.logger.log(
      `sendTestPush called for user=${userId.substring(0, 8)}, specificToken=${specificToken ? 'yes' : 'no'}, pushReady=${this.pushProvider.isReady()}`,
    );

    if (specificToken) {
      // Verify token ownership before sending
      const deviceToken = await this.prisma.deviceToken.findFirst({
        where: {
          userId,
          token: specificToken,
          isDeleted: false,
        },
      });

      if (!deviceToken) {
        this.logger.warn(
          `sendTestPush: token not found for user=${userId.substring(0, 8)}, hasToken=false`,
        );
        throw new NotFoundException(
          'Device token not found or does not belong to this user',
        );
      }

      this.logger.log(
        `sendTestPush: sending to specific token id=${deviceToken.id}, isActive=${deviceToken.isActive}`,
      );
      const result = await this.pushProvider.sendToTokens(
        [specificToken],
        title,
        body,
      );
      this.logger.log(
        `sendTestPush result: success=${result.success}, error=${result.error ?? 'none'}, messageId=${result.messageId ?? 'none'}`,
      );
      return result;
    }

    // Send to all user devices
    this.logger.log(
      `sendTestPush: sending to all devices for user=${userId.substring(0, 8)}`,
    );
    const result = await this.pushProvider.send({
      userId,
      category: PrismaCategory.SYSTEM_ALERT,
      title,
      body,
    });
    this.logger.log(
      `sendTestPush result: success=${result.success}, error=${result.error ?? 'none'}, messageId=${result.messageId ?? 'none'}`,
    );
    return result;
  }

  /**
   * Subscribe all existing active device tokens to the all_users topic.
   * Run once to seed existing devices. Processes in batches of 1000 (Firebase limit).
   */
  async subscribeAllExistingDevicesToTopic(
    topic: string = 'all_users',
  ): Promise<{ total: number; batches: number }> {
    const BATCH_SIZE = 1000;
    let cursor: string | undefined;
    let total = 0;
    let batches = 0;

    while (true) {
      const devices = await this.prisma.deviceToken.findMany({
        where: { isActive: true, isDeleted: false },
        select: { id: true, token: true },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      });

      if (devices.length === 0) break;

      const tokens = devices.map((d) => d.token);
      await this.pushProvider.subscribeToTopic(tokens, topic);
      batches++;
      total += tokens.length;
      cursor = devices[devices.length - 1].id;

      this.logger.log(
        `Subscribed batch ${batches} (${tokens.length} tokens) to topic: ${topic}`,
      );

      if (devices.length < BATCH_SIZE) break;
    }

    if (total === 0) {
      this.logger.log('No active device tokens to subscribe');
    } else {
      this.logger.log(
        `Finished subscribing ${total} tokens in ${batches} batches to topic: ${topic}`,
      );
    }

    return { total, batches };
  }

  /**
   * Broadcast a push to ALL active device tokens in staggered batches of
   * <= 500 tokens (the FCM multicast hard limit), instead of a single topic
   * fan-out. Batch i is delayed by `i * intervalSeconds` so users don't all
   * receive the push (and open the app) simultaneously — this protects the
   * connection-capped production RDS instance.
   *
   * Token reads reuse the exact same cursor pagination and active-token filter
   * (`isActive: true, isDeleted: false`) as `subscribeAllExistingDevicesToTopic`.
   * Tokens are de-duplicated before chunking so a token never gets two pushes.
   */
  async broadcastBatchedToAllDevices(payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    batchSize?: number;
    intervalSeconds?: number;
  }): Promise<BatchedBroadcastSummary> {
    // Clamp to safe bounds; fall back to defaults for non-finite inputs (NaN /
    // Infinity) so a direct programmatic call can't produce NaN chunk sizes.
    const batchSize = Number.isFinite(payload.batchSize)
      ? Math.min(Math.max(payload.batchSize as number, 1), 500)
      : 500;
    const intervalSeconds = Number.isFinite(payload.intervalSeconds)
      ? Math.max(payload.intervalSeconds as number, 0)
      : 120;

    // Page ALL active device tokens using the same batching approach as
    // subscribeAllExistingDevicesToTopic (DB page size of 1000).
    const DB_PAGE_SIZE = 1000;
    let cursor: string | undefined;
    const uniqueTokens = new Set<string>();

    while (true) {
      const devices = await this.prisma.deviceToken.findMany({
        where: { isActive: true, isDeleted: false },
        select: { id: true, token: true },
        take: DB_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      });

      if (devices.length === 0) break;

      // De-duplicate tokens across pages so a token appearing twice (e.g. shared
      // across rows) is only pushed once.
      for (const device of devices) {
        uniqueTokens.add(device.token);
      }
      cursor = devices[devices.length - 1].id;

      if (devices.length < DB_PAGE_SIZE) break;
    }

    const tokens = Array.from(uniqueTokens);
    const totalDevices = tokens.length;

    if (totalDevices === 0) {
      this.logger.warn(
        'Batched broadcast requested but no active device tokens were found; nothing queued',
      );
      return {
        totalDevices: 0,
        batches: 0,
        batchSize,
        estimatedDurationSeconds: 0,
      };
    }

    // Split tokens into chunks of <= batchSize.
    const chunks: string[][] = [];
    for (let i = 0; i < tokens.length; i += batchSize) {
      chunks.push(tokens.slice(i, i + batchSize));
    }

    // The last batch fires after (batches - 1) intervals.
    const estimatedDurationSeconds = (chunks.length - 1) * intervalSeconds;

    this.logger.log(
      `Batched broadcast: ${totalDevices} device(s) -> ${chunks.length} batch(es) of <= ${batchSize} ` +
        `at ${intervalSeconds}s intervals (estimated duration ${estimatedDurationSeconds}s)`,
    );

    // One job per chunk, staggered: batch i is delayed by i * intervalSeconds.
    const enqueueResults = await Promise.all(
      chunks.map((chunk, index) =>
        this.pushQueueService.queueTokenBatch(
          chunk,
          payload.title,
          payload.body,
          payload.data,
          index * intervalSeconds * 1000,
        ),
      ),
    );

    // Surface enqueue failures so the caller (and emitAsync) can detect them,
    // mirroring how the topic broadcast handler propagates queue failures.
    const failed = enqueueResults.filter((r) => !r.queued);
    if (failed.length > 0) {
      throw new Error(
        `Batched broadcast failed to enqueue ${failed.length}/${enqueueResults.length} batch(es): ` +
          failed.map((f) => f.error ?? 'unknown error').join('; '),
      );
    }

    return {
      totalDevices,
      batches: chunks.length,
      batchSize,
      estimatedDurationSeconds,
    };
  }

  // ============================================
  // Event Listeners (cross-module communication)
  // ============================================

  @OnEvent('notification.broadcast-batched')
  async handleBatchedBroadcastNotification(payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    batchSize?: number;
    intervalSeconds?: number;
  }): Promise<BatchedBroadcastSummary> {
    this.logger.log(
      `Handling batched broadcast event: "${payload.title}"`,
    );
    try {
      return await this.broadcastBatchedToAllDevices(payload);
    } catch (err) {
      this.logger.error(
        `Failed to run batched broadcast for "${payload.title}": ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Re-throw so emitAsync in the admin service can detect failure.
      throw err;
    }
  }

  @OnEvent('notification.broadcast')
  async handleBroadcastNotification(payload: {
    topic: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    this.logger.log(
      `Handling broadcast event for topic "${payload.topic}": "${payload.title}"`,
    );
    try {
      const result = await this.pushQueueService.queueTopicPush(
        payload.topic,
        payload.title,
        payload.body,
        payload.data,
      );
      if (!result.queued) {
        throw new Error(
          `Broadcast enqueue returned queued=false (jobId=${result.jobId}): ${result.error ?? 'unknown error'}`,
        );
      }
      this.logger.log(`Broadcast queued: jobId=${result.jobId}`);
    } catch (err) {
      this.logger.error(
        `Failed to queue broadcast for topic "${payload.topic}": ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Re-throw so emitAsync in broadcastNotification can detect failure
      throw err;
    }
  }

  @OnEvent('notification.seed-topic')
  async handleSeedTopic(payload: { topic: string }): Promise<void> {
    this.logger.log(`Handling seed-topic event for topic "${payload.topic}"`);
    try {
      await this.subscribeAllExistingDevicesToTopic(payload.topic);
    } catch (err) {
      this.logger.error(
        `Failed to seed topic "${payload.topic}": ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /**
   * Check if push notifications are properly configured.
   */
  isPushReady(): boolean {
    return this.pushProvider.isReady();
  }

  private toDeviceTokenResponse(token: {
    id: string;
    userId: string;
    token: string;
    platform: string;
    deviceName: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): DeviceTokenResponseDto {
    return {
      id: token.id,
      userId: token.userId,
      // Mask token for security - show first 8 and last 4 chars
      token:
        token.token.length > 12
          ? `${token.token.substring(0, 8)}...${token.token.substring(token.token.length - 4)}`
          : token.token,
      platform: token.platform as DevicePlatform,
      deviceName: token.deviceName || undefined,
      isActive: token.isActive,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }
}
