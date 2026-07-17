import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EnvConfig } from '@/shared/config/env.validation';
import { NotificationCategory as PrismaCategory } from '@prisma/client';
import {
  EmailQueueService,
  QueuedEmailResult,
} from '../queue/email-queue.service';

/**
 * Owns email delivery for the notification module: the legacy SMTP transporter
 * (synchronous sends) and the queue-backed asynchronous send path.
 *
 * Extracted verbatim from NotificationService to keep that class a thin facade;
 * behavior is intentionally identical.
 */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
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
}
