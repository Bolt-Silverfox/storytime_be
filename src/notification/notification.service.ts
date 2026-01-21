import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '../config/env.validation';
import * as nodemailer from 'nodemailer';
import { NotificationRegistry, Notifications } from './notification.registry';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPreference, NotificationCategory as PrismaCategory } from '@prisma/client';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from './notification.dto';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import {
  INotificationProvider,
  NotificationPayload,
  NotificationResult,
} from './providers/notification-provider.interface';

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
  ) {
    // Initialize legacy email transporter (for backward compatibility)
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get('SMTP_PORT') || 587,
      secure: this.configService.get('SMTP_SECURE'),
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
      tls: {
        rejectUnauthorized: false,
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
      let channels: string[] = ['in_app'];
      if (notification.medium === 'email') {
        channels = ['email', 'in_app'];
      }

      const results = await this.sendViaProvider(payload, channels);

      const success = results.some(r => r.success);
      return {
        success,
        messageId: results.find(r => r.messageId)?.messageId,
        error: results.find(r => !r.success)?.error,
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

  async sendEmail(
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

  private toNotificationPreferenceDto(
    pref: NotificationPreference,
  ): NotificationPreferenceDto {
    return {
      id: pref.id,
      type: pref.type,
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
      notifications: notifications.map(n => ({
        ...n,
        category: n.category as PrismaCategory,
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
