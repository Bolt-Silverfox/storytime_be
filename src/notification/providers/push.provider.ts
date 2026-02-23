import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '@/prisma/prisma.service';
import { EnvConfig } from '@/shared/config/env.validation';
import {
  INotificationProvider,
  NotificationPayload,
  NotificationResult,
} from './notification-provider.interface';

/**
 * Push Notification Provider using Firebase Cloud Messaging (FCM)
 * Sends push notifications to registered device tokens
 */
@Injectable()
export class PushProvider implements INotificationProvider, OnModuleInit {
  private readonly logger = new Logger(PushProvider.name);
  private isInitialized = false;

  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    const projectId = this.configService.get('FIREBASE_PROJECT_ID', {
      infer: true,
    });
    const clientEmail = this.configService.get('FIREBASE_CLIENT_EMAIL', {
      infer: true,
    });
    const privateKey = this.configService.get('FIREBASE_PRIVATE_KEY', {
      infer: true,
    });

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase credentials not configured. Push notifications will be disabled.',
      );
      return;
    }

    try {
      // Check if Firebase is already initialized
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            // Handle newline escaping in private key (common in env vars)
            privateKey: privateKey.replace(/\\n/g, '\n'),
          }),
        });
      }

      this.isInitialized = true;
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Firebase: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Firebase not initialized. Check configuration.',
      };
    }

    try {
      // Get all active device tokens for the user
      const deviceTokens = await this.prisma.deviceToken.findMany({
        where: {
          userId: payload.userId,
          isActive: true,
          isDeleted: false,
        },
        select: { id: true, token: true },
      });

      if (deviceTokens.length === 0) {
        this.logger.debug(`No active device tokens for user ${payload.userId}`);
        return {
          success: true,
          messageId: 'no_tokens',
        };
      }

      const tokens = deviceTokens.map((dt) => dt.token);

      // Build FCM message
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: this.serializeData(payload.data),
        android: {
          priority: 'high',
          notification: {
            channelId: 'storytime_default',
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              'content-available': 1,
            },
          },
        },
      };

      // Send to all devices
      this.logger.debug(
        `Sending push notification to ${tokens.length} devices for user ${payload.userId}`,
      );
      const response = await admin.messaging().sendEachForMulticast(message);

      this.logger.log(
        `Push notification sent to user ${payload.userId}: ${response.successCount}/${tokens.length} success, ${response.failureCount} failures`,
      );

      // Handle failed tokens (mark as inactive)
      await this.handleFailedTokens(deviceTokens, response.responses);

      // Collect detailed error information from failed sends
      const errorDetails: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          errorDetails.push(
            `token[${idx}]: ${resp.error.code} - ${resp.error.message}`,
          );
          this.logger.warn(
            `FCM send failed for token[${idx}]: ${resp.error.code} - ${resp.error.message}`,
          );
        }
      });

      return {
        success: response.successCount > 0,
        messageId: `batch_${response.successCount}/${tokens.length}`,
        error:
          errorDetails.length > 0
            ? `${response.failureCount} token(s) failed: ${errorDetails.join('; ')}`
            : undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to send push notification to user ${payload.userId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to send push notification',
      };
    }
  }

  /**
   * Send a push notification directly to specific tokens (bypasses user lookup)
   * Useful for testing or targeted notifications
   */
  async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<NotificationResult> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Firebase not initialized',
      };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: { title, body },
        data: data || {},
        android: {
          priority: 'high',
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              'content-available': 1,
            },
          },
        },
      };

      this.logger.debug(
        `Sending direct push notification to ${tokens.length} tokens`,
      );
      const response = await admin.messaging().sendEachForMulticast(message);

      this.logger.log(
        `Direct push sent: ${response.successCount}/${tokens.length} success`,
      );

      // Collect error details for failed sends
      const errorDetails: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          errorDetails.push(
            `token[${idx}]: ${resp.error.code} - ${resp.error.message}`,
          );
          this.logger.warn(
            `Direct FCM send failed for token[${idx}]: ${resp.error.code} - ${resp.error.message}`,
          );
        }
      });

      return {
        success: response.successCount > 0,
        messageId: `direct_${response.successCount}/${tokens.length}`,
        error:
          errorDetails.length > 0
            ? `${response.failureCount} token(s) failed: ${errorDetails.join('; ')}`
            : undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to send direct push notification: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to send to tokens',
      };
    }
  }

  /**
   * Send a push notification to a specific topic
   * Useful for broadcast notifications
   */
  async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<NotificationResult> {
    if (!this.isInitialized) {
      return {
        success: false,
        error: 'Firebase not initialized',
      };
    }

    try {
      const message: admin.messaging.Message = {
        topic,
        notification: { title, body },
        data: data || {},
      };

      const messageId = await admin.messaging().send(message);

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to send to topic',
      };
    }
  }

  /**
   * Subscribe tokens to a topic
   */
  async subscribeToTopic(tokens: string[], topic: string): Promise<void> {
    if (!this.isInitialized) {
      this.logger.warn('Cannot subscribe to topic: Firebase not initialized');
      return;
    }

    try {
      await admin.messaging().subscribeToTopic(tokens, topic);
      this.logger.log(`Subscribed ${tokens.length} tokens to topic: ${topic}`);
    } catch (error) {
      this.logger.error(
        `Failed to subscribe to topic: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Unsubscribe tokens from a topic
   */
  async unsubscribeFromTopic(tokens: string[], topic: string): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await admin.messaging().unsubscribeFromTopic(tokens, topic);
      this.logger.log(
        `Unsubscribed ${tokens.length} tokens from topic: ${topic}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to unsubscribe from topic: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Check if Firebase is properly configured and ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Handle failed tokens by marking them as inactive
   */
  private async handleFailedTokens(
    deviceTokens: Array<{ id: string; token: string }>,
    responses: admin.messaging.SendResponse[],
  ): Promise<void> {
    const invalidTokenIds: string[] = [];

    responses.forEach((response, index) => {
      if (!response.success && response.error) {
        const errorCode = response.error.code;
        // These error codes indicate the token is no longer valid
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
        ) {
          invalidTokenIds.push(deviceTokens[index].id);
        }
      }
    });

    if (invalidTokenIds.length > 0) {
      await this.prisma.deviceToken.updateMany({
        where: { id: { in: invalidTokenIds } },
        data: { isActive: false },
      });
      this.logger.log(`Marked ${invalidTokenIds.length} tokens as inactive`);
    }
  }

  /**
   * Serialize data object to string values (FCM requirement)
   */
  private serializeData(
    data?: Record<string, unknown>,
  ): Record<string, string> {
    if (!data) return {};

    const serialized: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      serialized[key] =
        typeof value === 'string' ? value : JSON.stringify(value);
    }
    return serialized;
  }
}
