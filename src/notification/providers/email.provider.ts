import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import * as nodemailer from 'nodemailer';
import {
  INotificationProvider,
  NotificationPayload,
  NotificationResult,
} from './notification-provider.interface';

const maskAddress = (address: string): string => {
  const at = address.lastIndexOf('@');
  return at < 1 ? '***' : `${address.charAt(0)}***${address.slice(at)}`;
};

const maskRecipient = (to: unknown): string => {
  if (typeof to === 'string') return maskAddress(to);
  if (Array.isArray(to)) {
    return to
      .map((entry) => (typeof entry === 'string' ? maskAddress(entry) : '***'))
      .join(', ');
  }
  return '***';
};

/**
 * Email Notification Provider
 * Sends notifications via SMTP/Email
 */
@Injectable()
export class EmailProvider implements INotificationProvider {
  private readonly logger = new Logger(EmailProvider.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService<EnvConfig, true>) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get('SMTP_PORT') || 587,
      secure: this.configService.get('SMTP_SECURE'),
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
    });
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    try {
      // Email must be provided in the data object
      const email = payload.data?.email as string;
      if (!email) {
        throw new BadRequestException(
          'Email address is required for email notifications',
        );
      }

      const mailOptions = {
        from: {
          name: this.configService.get('DEFAULT_SENDER_NAME'),
          address: this.configService.get('DEFAULT_SENDER_EMAIL'),
        },
        to: email,
        subject: payload.title,
        html: payload.body,
      };

      const maskedRecipient = maskRecipient(email);
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(
        `Email sent successfully to ${maskedRecipient}: ${info.messageId}`,
      );

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send email';
      this.logger.error(`Error sending email:`, errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
