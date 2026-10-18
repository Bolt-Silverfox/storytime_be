import { Injectable, Logger } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import * as nodemailer from 'nodemailer';

@Injectable()
export class SmtpHealthIndicator {
  private readonly logger = new Logger(SmtpHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService<EnvConfig,
    true>,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      const transporter = nodemailer.createTransport({
        host: this.configService.get('SMTP_HOST'),
        port: this.configService.get('SMTP_PORT') || 587,
        secure: this.configService.get('SMTP_SECURE'),
        auth: {
          user: this.configService.get('SMTP_USER'),
          pass: this.configService.get('SMTP_PASS'),
        },
        connectionTimeout: 5000, // 5 second timeout for health check
      });

      // Verify SMTP connection
      await transporter.verify();

      // Close the connection
      transporter.close();

      const duration = Date.now() - startTime;

      return this.healthIndicatorService.check(key).up({
        duration: `${duration}ms`,
        host: this.configService.get('SMTP_HOST'),
        port: this.configService.get('SMTP_PORT') || 587,
        connection: 'verified',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = ErrorHandler.extractMessage(error);

      this.logger.warn(`SMTP health check failed: ${errorMessage}`);

      return this.healthIndicatorService.check(key).down({
          duration: `${duration}ms`,
          host: this.configService.get('SMTP_HOST'),
          error: errorMessage,
        });
    }
  }
}
