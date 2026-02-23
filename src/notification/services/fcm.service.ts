import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '@/prisma/prisma.service';

export interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: 'high' | 'normal';
  imageUrl?: string;
}

export interface PushNotificationResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private isInitialized = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');

    if (!projectId || !privateKey || !clientEmail) {
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
            privateKey: privateKey.replace(/\\n/g, '\n'),
            clientEmail,
          }),
        });
      }

      this.isInitialized = true;
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Firebase Admin SDK: ${ErrorHandler.extractMessage(error)}`,
      );
    }
  }

  /**
   * Send push notification to a specific user's devices
   */
  async sendToUser(
    payload: PushNotificationPayload,
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized) {
      this.logger.warn('Firebase not initialized. Skipping push notification.');
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    try {
      // Get user's active device tokens (excluding web - web uses SSE)
      const deviceTokens = await this.prisma.deviceToken.findMany({
        where: {
          userId: payload.userId,
          isActive: true,
          platform: { in: ['ios', 'android'] },
        },
        select: { token: true },
      });

      if (deviceTokens.length === 0) {
        this.logger.debug(
          `No active mobile device tokens found for user ${payload.userId}`,
        );
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
      }

      const tokens = deviceTokens.map((dt) => dt.token);

      // Build the multicast message
      const message: admin.messaging.MulticastMessage = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data,
        tokens,
        android: {
          priority: payload.priority === 'high' ? 'high' : 'normal',
          notification: {
            channelId: 'story_generation',
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              'content-available': 1,
            },
          },
          headers: {
            'apns-priority': payload.priority === 'high' ? '10' : '5',
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      this.logger.log(
        `FCM sent to user ${payload.userId}: ${response.successCount}/${tokens.length} devices successful`,
      );

      // Handle failed tokens
      const invalidTokens: string[] = [];
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const error = resp.error;
            // Mark invalid tokens for cleanup
            if (
              error?.code === 'messaging/invalid-registration-token' ||
              error?.code === 'messaging/registration-token-not-registered'
            ) {
              invalidTokens.push(tokens[idx]);
            } else {
              this.logger.warn(
                `FCM send failed for token: ${error?.code} - ${error?.message}`,
              );
            }
          }
        });

        // Deactivate invalid tokens
        if (invalidTokens.length > 0) {
          await this.deactivateTokens(invalidTokens);
        }
      }

      // Update lastUsed for successful tokens
      const successfulTokens = tokens.filter((t) => !invalidTokens.includes(t));
      if (successfulTokens.length > 0) {
        await this.prisma.deviceToken.updateMany({
          where: { token: { in: successfulTokens } },
          data: { lastUsed: new Date() },
        });
      }

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (error) {
      this.logger.error(
        `Failed to send FCM notification to user ${payload.userId}: ${ErrorHandler.extractMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Send story completion notification
   */
  async sendStoryCompletionNotification(
    userId: string,
    storyId: string,
    storyTitle: string,
  ): Promise<PushNotificationResult> {
    return this.sendToUser({
      userId,
      title: 'Your story is ready! 📖',
      body: `"${storyTitle}" has been generated`,
      data: {
        type: 'story_generation_complete',
        storyId,
        action: 'open_story',
      },
      priority: 'high',
    });
  }

  /**
   * Send story generation failure notification
   */
  async sendStoryFailureNotification(
    userId: string,
    jobId: string,
    errorMessage?: string,
  ): Promise<PushNotificationResult> {
    return this.sendToUser({
      userId,
      title: 'Story generation failed',
      body: 'We encountered an issue generating your story. Please try again.',
      data: {
        type: 'story_generation_failed',
        jobId,
        error: errorMessage || 'Unknown error',
      },
      priority: 'normal',
    });
  }

  /**
   * Send voice synthesis completion notification
   */
  async sendVoiceCompletionNotification(
    userId: string,
    jobId: string,
    audioUrl: string,
  ): Promise<PushNotificationResult> {
    return this.sendToUser({
      userId,
      title: 'Audio ready! 🎧',
      body: 'Your audio has been generated and is ready to play',
      data: {
        type: 'voice_synthesis_complete',
        jobId,
        audioUrl,
        action: 'play_audio',
      },
      priority: 'high',
    });
  }

  /**
   * Send voice synthesis failure notification
   */
  async sendVoiceFailureNotification(
    userId: string,
    jobId: string,
    errorMessage?: string,
  ): Promise<PushNotificationResult> {
    return this.sendToUser({
      userId,
      title: 'Audio generation failed',
      body: 'We encountered an issue generating your audio. Please try again.',
      data: {
        type: 'voice_synthesis_failed',
        jobId,
        error: errorMessage || 'Unknown error',
      },
      priority: 'normal',
    });
  }

  /**
   * Deactivate invalid tokens
   */
  private async deactivateTokens(tokens: string[]): Promise<void> {
    try {
      await this.prisma.deviceToken.updateMany({
        where: { token: { in: tokens } },
        data: { isActive: false },
      });
      this.logger.log(`Deactivated ${tokens.length} invalid device tokens`);
    } catch (error) {
      this.logger.error(
        `Failed to deactivate tokens: ${ErrorHandler.extractMessage(error)}`,
      );
    }
  }

  /**
   * Check if FCM is available
   */
  isAvailable(): boolean {
    return this.isInitialized;
  }
}
