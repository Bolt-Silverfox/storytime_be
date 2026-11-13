import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '@/shared/config/env.validation';
import * as nodemailer from 'nodemailer';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;

type ProbeResult = { up: boolean; duration: number; error?: string };

@Injectable()
export class SmtpHealthIndicator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SmtpHealthIndicator.name);
  private lastKnownUp: boolean | null = null;
  private inFlight: Promise<ProbeResult> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private destroyed = false;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  onModuleInit(): void {
    void this.refreshAndSchedule();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  cachedHealth(key: string): HealthIndicatorResult {
    const session = this.healthIndicatorService.check(key);
    return this.lastKnownUp === true ? session.up() : session.down();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const result = await this.probe();
    const session = this.healthIndicatorService.check(key);
    const host = this.configService.get('SMTP_HOST');

    if (result.up) {
      return session.up({
        duration: `${result.duration}ms`,
        host,
        port: this.configService.get('SMTP_PORT') || 587,
        connection: 'verified',
      });
    }
    return session.down({
      duration: `${result.duration}ms`,
      host,
      error: result.error,
    });
  }

  private async refreshAndSchedule(): Promise<void> {
    const result = await this.probe();
    if (this.destroyed) return;

    this.consecutiveFailures = result.up ? 0 : this.consecutiveFailures + 1;
    const delay = result.up
      ? REFRESH_INTERVAL_MS
      : Math.min(
          BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1),
          REFRESH_INTERVAL_MS,
        );
    this.timer = setTimeout(() => {
      void this.refreshAndSchedule();
    }, delay);
    this.timer.unref();
  }

  private probe(): Promise<ProbeResult> {
    this.inFlight ??= this.verify().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async verify(): Promise<ProbeResult> {
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
        connectionTimeout: 5000,
      });

      await transporter.verify();
      transporter.close();

      this.lastKnownUp = true;
      return { up: true, duration: Date.now() - startTime };
    } catch (error) {
      const errorMessage = ErrorHandler.extractMessage(error);
      this.logger.warn(`SMTP health check failed: ${errorMessage}`);
      this.lastKnownUp = false;
      return {
        up: false,
        duration: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }
}
