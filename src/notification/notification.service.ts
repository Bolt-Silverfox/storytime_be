import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { NotificationRegistry, Notifications } from './notification.registry';
import { PrismaClient, NotificationPreference } from '@prisma/client';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from './notification.dto';

const prisma = new PrismaClient();

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) { }

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
        throw new Error(`invalid notification: ${type}`);
      }

      const err = notification.validate(data);
      if (err) {
        throw new Error(`${type} failed: ${err}`);
      }

      const template = await notification.getTemplate(data);

      if (notification.medium != 'email') {
        throw new Error(`medium: ${notification.medium} not implemented`);
      }

      const resp = await this.sendEmail(
        data?.email as string,
        notification.subject,
        template,
      );
      return resp;
    } catch (error) {
      return {
        success: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        error: error?.message,
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
      const payload = {
        sender: {
          email: this.configService.get<string>('DEFAULT_SENDER_EMAIL'),
          name: this.configService.get<string>('DEFAULT_SENDER_NAME'),
        },
        to: [{ email }],
        subject: subject,
        htmlContent: htmlContent,
      };

      const response = await firstValueFrom(
        this.httpService.post<{ messageId?: string }>(
          this.configService.get<string>('BREVO_API_URL') ?? '',
          payload,
          {
            headers: {
              'api-key': this.configService.get<string>('BREVO_API_KEY'),
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );

      const data = response.data;
      this.logger.log('email sent successfully:', data);
      return {
        success: true,
        messageId: data.messageId || 'Message sent',
      };
    } catch (error: unknown) {
      let errorMessage = 'Failed to send email';
      const maybeMessage = (error as any)?.response?.data?.message;
      if (maybeMessage) {
        errorMessage = maybeMessage;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.logger.error('Error sending email:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private toNotificationPreferenceDto(pref: NotificationPreference): NotificationPreferenceDto {
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
    const pref = await prisma.notificationPreference.create({
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
    const pref = await prisma.notificationPreference.update({
      where: { id },
      data: dto,
    });
    return this.toNotificationPreferenceDto(pref);
  }

  async getForUser(userId: string): Promise<NotificationPreferenceDto[]> {
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId },
    });
    return prefs.map((p: any) => this.toNotificationPreferenceDto(p));
  }

  async getForKid(kidId: string): Promise<NotificationPreferenceDto[]> {
    const prefs = await prisma.notificationPreference.findMany({
      where: { kidId },
    });
    return prefs.map((p: any) => this.toNotificationPreferenceDto(p));
  }

  async getById(id: string): Promise<NotificationPreferenceDto> {
    const pref = await prisma.notificationPreference.findUnique({
      where: { id },
    });
    if (!pref) throw new NotFoundException('Notification preference not found');
    return this.toNotificationPreferenceDto(pref);
  }
}
