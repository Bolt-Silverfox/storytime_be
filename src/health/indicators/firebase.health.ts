import { Injectable, Logger } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

/**
 * Health indicator for Firebase/FCM
 * Checks if Firebase Admin SDK is properly initialized
 */
@Injectable()
export class FirebaseHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(FirebaseHealthIndicator.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      // Check if Firebase is configured
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
      if (!projectId) {
        return this.getStatus(key, true, {
          duration: `${Date.now() - startTime}ms`,
          status: 'not_configured',
          message: 'Firebase not configured (optional service)',
        });
      }

      // Check if Firebase app is initialized
      let app: admin.app.App;
      try {
        app = admin.app();
      } catch {
        // Firebase not initialized yet - this is expected on first health check
        return this.getStatus(key, true, {
          duration: `${Date.now() - startTime}ms`,
          status: 'not_initialized',
          message: 'Firebase SDK not yet initialized',
        });
      }

      // Verify the app is functional by checking project ID
      const appProjectId = app.options.projectId;
      const duration = Date.now() - startTime;

      if (appProjectId !== projectId) {
        throw new HealthCheckError(
          'Firebase configuration mismatch',
          this.getStatus(key, false, {
            duration: `${duration}ms`,
            configured: projectId,
            actual: appProjectId,
            error: 'Project ID mismatch',
          }),
        );
      }

      return this.getStatus(key, true, {
        duration: `${duration}ms`,
        projectId: appProjectId,
        status: 'initialized',
      });
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      const duration = Date.now() - startTime;
      const errorMessage =
        ErrorHandler.extractMessage(error);

      this.logger.warn(`Firebase health check failed: ${errorMessage}`);

      throw new HealthCheckError(
        'Firebase health check failed',
        this.getStatus(key, false, {
          duration: `${duration}ms`,
          error: errorMessage,
        }),
      );
    }
  }
}
