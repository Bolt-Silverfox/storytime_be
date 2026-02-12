import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EnvConfig } from '@/shared/config/env.validation';
import * as nodemailer from 'nodemailer';
import { NotificationRegistry, Notifications } from './notification.registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationCategory as PrismaCategory,
  NotificationType as PrismaNotificationType,
} from '@prisma/client';
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
import { AppEvents, NotificationSentEvent } from '@/shared/events';

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
    private readonly eventEmitter: EventEmitter2,
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
        throw new BadRequestException(`Invalid notification type: ${type}`);
      }

      const err = notification.validate(data);
      if (err) {
        throw new BadRequestException(`Validation failed for ${type}: ${err}`);
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

        // Emit notification sent event for successful sends
        if (result.success && payload.userId) {
          const notificationType = channel as 'push' | 'in_app' | 'email';
          this.eventEmitter.emit(AppEvents.NOTIFICATION_SENT, {
            notificationId:
              result.messageId ?? `${payload.userId}-${Date.now()}`,
            userId: payload.userId,
            category: payload.category,
            type: notificationType,
            sentAt: new Date(),
          } satisfies NotificationSentEvent);
        }
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
}
