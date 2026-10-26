import { Injectable, Logger } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { getApp, type App } from 'firebase-admin/app';

/**
 * Health indicator for Firebase/FCM
 * Checks if Firebase Admin SDK is properly initialized
 */
@Injectable()
export class FirebaseHealthIndicator {
  private readonly logger = new Logger(FirebaseHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly configService: ConfigService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Check if Firebase is configured
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
      if (!projectId) {
        return this.healthIndicatorService.check(key).up({
          duration: `${Date.now() - startTime}ms`,
          state: 'not_configured',
          message: 'Firebase not configured (optional service)',
        });
      }

      // Check if Firebase app is initialized
      let app: App;
      try {
        app = getApp();
      } catch {
        // Firebase not initialized yet - this is expected on first health check
        return this.healthIndicatorService.check(key).up({
          duration: `${Date.now() - startTime}ms`,
          state: 'not_initialized',
          message: 'Firebase SDK not yet initialized',
        });
      }

      // Verify the app is functional by checking project ID
      const appProjectId = app.options.projectId;
      const duration = Date.now() - startTime;

      if (appProjectId !== projectId) {
        return this.healthIndicatorService.check(key).down({
          duration: `${duration}ms`,
          configured: projectId,
          actual: appProjectId,
          error: 'Project ID mismatch',
        });
      }

      return this.healthIndicatorService.check(key).up({
        duration: `${duration}ms`,
        projectId: appProjectId,
        state: 'initialized',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = ErrorHandler.extractMessage(error);

      this.logger.warn(`Firebase health check failed: ${errorMessage}`);

      return this.healthIndicatorService.check(key).down({
        duration: `${duration}ms`,
        error: errorMessage,
      });
    }
  }
}
