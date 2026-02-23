import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import type { v2 as CloudinaryType } from 'cloudinary';

/**
 * Health indicator for Cloudinary
 * Checks if Cloudinary is properly configured and accessible
 */
@Injectable()
export class CloudinaryHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(CloudinaryHealthIndicator.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject('CLOUDINARY')
    private readonly cloudinary: typeof CloudinaryType | null,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Check if Cloudinary is configured
      const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
      if (!cloudName) {
        return this.getStatus(key, true, {
          duration: `${Date.now() - startTime}ms`,
          status: 'not_configured',
          message: 'Cloudinary not configured (optional service)',
        });
      }

      if (!this.cloudinary) {
        return this.getStatus(key, true, {
          duration: `${Date.now() - startTime}ms`,
          status: 'not_injected',
          message: 'Cloudinary provider not available',
        });
      }

      // Ping Cloudinary API to verify connectivity
      // Using admin.ping() which is a lightweight API call
      const result = await this.cloudinary.api.ping();
      const duration = Date.now() - startTime;

      if (result.status !== 'ok') {
        throw new HealthCheckError(
          'Cloudinary API returned non-ok status',
          this.getStatus(key, false, {
            duration: `${duration}ms`,
            cloudName,
            status: result.status,
          }),
        );
      }

      return this.getStatus(key, true, {
        duration: `${duration}ms`,
        cloudName,
        status: 'ok',
      });
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      const duration = Date.now() - startTime;
      const errorMessage =
        ErrorHandler.extractMessage(error);

      this.logger.warn(`Cloudinary health check failed: ${errorMessage}`);

      // Don't fail health check for rate limits or transient errors
      if (
        errorMessage.includes('Rate Limit') ||
        errorMessage.includes('timeout')
      ) {
        return this.getStatus(key, true, {
          duration: `${duration}ms`,
          status: 'degraded',
          message: errorMessage,
        });
      }

      throw new HealthCheckError(
        'Cloudinary health check failed',
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
        }),
      );
    }
  }
}
