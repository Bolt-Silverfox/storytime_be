import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
  NotificationPreferenceDto,
} from './dto/notification.dto';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import {
  INotificationProvider,
  NotificationPayload,
  NotificationResult,
} from './providers/notification-provider.interface';
import {
  EmailQueueService,
  QueuedEmailResult,
} from './queue/email-queue.service';

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
  }

  async sendNotification(
    type: Notifications,
    data: Record<string, any>,
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
      this.logger.error(
        `Failed to send notification: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        error: error?.message || 'Unknown error',
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
        this.logger.error(
          `Failed to send via ${channel}: ${error.message}`,
          error.stack,
        );
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
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
    const categories = Object.keys(preferences) as PrismaCategory[];
    const channels: PrismaNotificationType[] = [
      PrismaNotificationType.in_app,
      PrismaNotificationType.push,
    ];

    // Upsert preferences for each category + channel combination
    for (const category of categories) {
      const enabled = preferences[category];

      for (const type of channels) {
        await this.prisma.notificationPreference.upsert({
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
            isDeleted: false,
            deletedAt: null,
          },
        });
      }
    }

    return this.getUserPreferencesGrouped(userId);
  }

  /**
   * Seed default notification preferences for a new user.
   * Creates preferences for all user-facing categories with enabled: true.
   * Called during user registration.
   */
  async seedDefaultPreferences(userId: string): Promise<void> {
    // User-facing categories that should have preferences (excludes auth/system categories)
    const userFacingCategories: PrismaCategory[] = [
      // Subscription & Billing
      PrismaCategory.SUBSCRIPTION_REMINDER,
      PrismaCategory.SUBSCRIPTION_ALERT,
      // Engagement / Discovery
      PrismaCategory.NEW_STORY,
      PrismaCategory.STORY_FINISHED,
      // Reminders
      PrismaCategory.INCOMPLETE_STORY_REMINDER,
      PrismaCategory.DAILY_LISTENING_REMINDER,
    ];

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
    const where: any = {
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
}
