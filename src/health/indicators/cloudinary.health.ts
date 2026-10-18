import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import type { v2 as CloudinaryType } from 'cloudinary';

/**
 * Health indicator for Cloudinary
 * Checks if Cloudinary is properly configured and accessible
 */
@Injectable()
export class CloudinaryHealthIndicator {
  private readonly logger = new Logger(CloudinaryHealthIndicator.name);

  constructor(
    
    private readonly healthIndicatorService: HealthIndicatorService,private readonly configService: ConfigService,
    @Optional()
    @Inject('CLOUDINARY')
    private readonly cloudinary: typeof CloudinaryType | null,
  ) {
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Check if Cloudinary is configured
      const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
      if (!cloudName) {
        return this.healthIndicatorService.check(key).up({
          duration: `${Date.now() - startTime}ms`,
          state: 'not_configured',
          message: 'Cloudinary not configured (optional service)',
        });
      }

      if (!this.cloudinary) {
        return this.healthIndicatorService.check(key).up({
          duration: `${Date.now() - startTime}ms`,
          state: 'not_injected',
          message: 'Cloudinary provider not available',
        });
      }

      // Ping Cloudinary API to verify connectivity
      // Using admin.ping() which is a lightweight API call
      const result = await this.cloudinary.api.ping();
      const duration = Date.now() - startTime;

      if (result.status !== 'ok') {
        return this.healthIndicatorService.check(key).down({
            duration: `${duration}ms`,
            cloudName,
            httpStatus: result.status,
          });
      }

      return this.healthIndicatorService.check(key).up({
        duration: `${duration}ms`,
        cloudName,
        state: 'ok',
      });
    } catch (error) {

      const duration = Date.now() - startTime;
      const errorMessage = ErrorHandler.extractMessage(error);

      this.logger.warn(`Cloudinary health check failed: ${errorMessage}`);

      // Don't fail health check for rate limits or transient errors
      if (
        errorMessage.includes('Rate Limit') ||
        errorMessage.includes('timeout')
      ) {
        return this.healthIndicatorService.check(key).up({
          duration: `${duration}ms`,
          state: 'degraded',
          message: errorMessage,
        });
      }

      return this.healthIndicatorService.check(key).down({
          duration: `${duration}ms`,
          error: errorMessage,
        });
    }
  }
}
