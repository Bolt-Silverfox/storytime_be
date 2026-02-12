import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EnvConfig } from '@/shared/config/env.validation';
import { EMAIL_QUEUE_NAME } from './email-queue.constants';
import { EmailJobData, EmailJobResult } from './email-job.interface';
import { EmailDeliveryException } from '@/shared/exceptions/processing.exception';

/**
 * Email Queue Processor
 * Handles email sending jobs with retry support
 */
@Processor(EMAIL_QUEUE_NAME, { concurrency: 10 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService<EnvConfig, true>) {
    super();
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const nodeEnv = this.configService.get('NODE_ENV');
    const isProduction = nodeEnv === 'production';

    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get('SMTP_PORT') || 587,
      secure: this.configService.get('SMTP_SECURE'),
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
      tls: {
        // Enable TLS validation in production for security
        rejectUnauthorized: isProduction,
      },
      // Connection pooling for better performance
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });

    this.logger.log(
      `Email transporter initialized (TLS validation: ${isProduction ? 'enabled' : 'disabled'})`,
    );
  }

  /**
   * Process email job
   * This method is called by BullMQ for each job
   */
  async process(job: Job<EmailJobData>): Promise<EmailJobResult> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { to, subject, html, userId, category, jobId } = job.data;
    const attemptsMade = job.attemptsMade + 1;

    this.logger.log(
      `Processing email job ${jobId} (attempt ${attemptsMade}): ${category} to ${to}`,
    );

    try {
      const mailOptions = {
        from: {
          name: this.configService.get('DEFAULT_SENDER_NAME'),
          address: this.configService.get('DEFAULT_SENDER_EMAIL'),
        },
        to,
        subject,
        html,
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.log(
        `Email sent successfully: ${jobId} -> ${to} (messageId: ${info.messageId})`,
      );

      return {
        success: true,
        messageId: info.messageId,
        attemptsMade,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Email job ${jobId} failed (attempt ${attemptsMade}): ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Throw error to trigger retry
      throw new EmailDeliveryException(to, errorMessage);
    }
  }

  /**
   * Called when a job completes successfully
   */
  @OnWorkerEvent('completed')
  onCompleted(job: Job<EmailJobData>, result: EmailJobResult): void {
    this.logger.log(
      `Job ${job.data.jobId} completed: ${job.data.category} to ${job.data.to} ` +
      `(attempts: ${result.attemptsMade}, messageId: ${result.messageId})`,
    );
  }

  /**
   * Called when a job fails (before retry)
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJobData> | undefined, error: Error): void {
    if (!job) {
      this.logger.error('Job failed with no job data', error.stack);
      return;
    }

    const { jobId, to, category } = job.data;
    const willRetry = job.attemptsMade < (job.opts.attempts || 0);

    if (willRetry) {
      this.logger.warn(
        `Job ${jobId} failed (attempt ${job.attemptsMade}), will retry: ${error.message}`,
      );
    } else {
      this.logger.error(
        `Job ${jobId} permanently failed after ${job.attemptsMade} attempts: ` +
        `${category} to ${to} - ${error.message}`,
        error.stack,
      );
      // Here you could emit an event for alerting/monitoring
      // this.eventEmitter.emit('email.permanently_failed', { job, error });
    }
  }

  /**
   * Called when worker becomes active
   */
  @OnWorkerEvent('active')
  onActive(job: Job<EmailJobData>): void {
    this.logger.debug(`Processing job ${job.data.jobId}: ${job.data.category}`);
  }

  /**
   * Called when worker encounters an error
   */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error('Worker error:', error.stack);
  }
}
