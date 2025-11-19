import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationRegistry, Notifications } from './notification.registry';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPreference } from '@prisma/client';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from './notification.dto';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT') || 587,
      secure: this.configService.get<boolean>('SMTP_SECURE') || false,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendNotification(
    type: Notifications,
    data: Record<string, any>,
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

      if (notification.medium !== 'email') {
        throw new Error(`Medium ${notification.medium} not implemented`);
      }

      const resp = await this.sendEmail(
        data?.email as string,
        notification.subject,
        template,
      );
      return resp;
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
          name: this.configService.get<string>('DEFAULT_SENDER_NAME')!,
          address: this.configService.get<string>('DEFAULT_SENDER_EMAIL')!,
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
      where: { id },
      data: dto,
    });
    return this.toNotificationPreferenceDto(pref);
  }

  async getForUser(userId: string): Promise<NotificationPreferenceDto[]> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getForKid(kidId: string): Promise<NotificationPreferenceDto[]> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { kidId },
    });
    return prefs.map((p) => this.toNotificationPreferenceDto(p));
  }

  async getById(id: string): Promise<NotificationPreferenceDto> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { id },
    });
    if (!pref) throw new NotFoundException('Notification preference not found');
    return this.toNotificationPreferenceDto(pref);
  }
}
