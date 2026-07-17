import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { NotificationCategory as PrismaCategory } from '@prisma/client';
import {
  DEVICE_TOKEN_REPOSITORY,
  IDeviceTokenRepository,
} from '../repositories';
import { PushProvider } from '../providers/push.provider';
import { NotificationResult } from '../providers/notification-provider.interface';
import { PushQueueService } from '../queue/push-queue.service';
import {
  DeviceTokenResponseDto,
  DeviceTokenListResponseDto,
  DevicePlatform,
} from '../dto/device-token.dto';

/**
 * Owns push-device management for the notification module: device-token
 * registration/lifecycle (with masking + FCM topic side-effects), test pushes,
 * topic broadcast/seeding, and push readiness checks.
 *
 * Extracted verbatim from NotificationService to keep that class a thin facade;
 * behavior is intentionally identical. The @OnEvent listeners remain on
 * NotificationService (single registration) and delegate to this service.
 */
@Injectable()
export class NotificationDeviceService {
  private readonly logger = new Logger(NotificationDeviceService.name);

  constructor(
    @Inject(DEVICE_TOKEN_REPOSITORY)
    private readonly deviceTokenRepository: IDeviceTokenRepository,
    private readonly pushProvider: PushProvider,
    private readonly pushQueueService: PushQueueService,
  ) {}

  /**
   * Register a device token for push notifications.
   * If the token already exists for this user, update it.
   * If the token exists for a different user, reassign it.
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
    deviceName?: string,
  ): Promise<DeviceTokenResponseDto> {
    // Validate platform enum
    if (!Object.values(DevicePlatform).includes(platform)) {
      throw new BadRequestException(
        `Invalid platform. Must be one of: ${Object.values(DevicePlatform).join(', ')}`,
      );
    }

    // Check if token exists
    const existingToken =
      await this.deviceTokenRepository.findUniqueByToken(token);

    if (existingToken) {
      // If same user, just update
      if (existingToken.userId === userId) {
        const updated = await this.deviceTokenRepository.updateByToken(token, {
          platform,
          deviceName,
          isActive: true,
          isDeleted: false,
          deletedAt: null,
        });
        this.logger.log(`Updated device token for user ${userId}`);
        // Re-subscribe to all_users topic (best-effort; don't fail token save on FCM side effects)
        this.pushProvider
          .subscribeToTopic([token], 'all_users')
          .catch((err) =>
            this.logger.warn(
              `Failed to subscribe updated token to all_users: ${(err as Error).message}`,
            ),
          );
        return this.toDeviceTokenResponse(updated);
      }

      // Different user - reassign the token
      const updated = await this.deviceTokenRepository.updateByToken(token, {
        userId,
        platform,
        deviceName,
        isActive: true,
        isDeleted: false,
        deletedAt: null,
      });
      this.logger.log(
        `Reassigned device token from user ${existingToken.userId} to ${userId}`,
      );
      // Subscribe reassigned token to all_users topic (best-effort)
      this.pushProvider
        .subscribeToTopic([token], 'all_users')
        .catch((err) =>
          this.logger.warn(
            `Failed to subscribe reassigned token to all_users: ${(err as Error).message}`,
          ),
        );
      return this.toDeviceTokenResponse(updated);
    }

    // Collect old tokens before deactivating (for FCM topic unsubscribe)
    let oldTokenStrings: string[] = [];
    if (deviceName) {
      const oldTokens =
        await this.deviceTokenRepository.findTokensForDeviceDedup({
          userId,
          platform,
          deviceName,
          token,
        });
      oldTokenStrings = oldTokens.map((t) => t.token);
    }

    // Deactivate old tokens and create new one atomically
    const newToken = await this.deviceTokenRepository.executeTransaction(
      async (tx) => {
        if (deviceName) {
          await this.deviceTokenRepository.updateManyTokens(
            {
              userId,
              platform,
              deviceName,
              isDeleted: false,
              token: { not: token },
            },
            { isActive: false, isDeleted: true, deletedAt: new Date() },
            tx,
          );
        }
        return this.deviceTokenRepository.createToken(
          {
            userId,
            token,
            platform,
            deviceName,
          },
          tx,
        );
      },
    );
    this.logger.log(`Registered new device token for user ${userId}`);

    // Best-effort unsubscribe old tokens from broadcast topic
    if (oldTokenStrings.length > 0) {
      this.pushProvider
        .unsubscribeFromTopic(oldTokenStrings, 'all_users')
        .catch((err) =>
          this.logger.warn(
            `Failed to unsubscribe old tokens from all_users: ${(err as Error).message}`,
          ),
        );
    }

    // Subscribe the new token to the all_users topic (best-effort; don't fail registration on FCM side effects)
    this.pushProvider
      .subscribeToTopic([token], 'all_users')
      .catch((err) =>
        this.logger.warn(
          `Failed to subscribe new token to all_users: ${(err as Error).message}`,
        ),
      );

    return this.toDeviceTokenResponse(newToken);
  }

  /**
   * Get all active devices for a user.
   */
  async getUserDevices(userId: string): Promise<DeviceTokenListResponseDto> {
    const devices =
      await this.deviceTokenRepository.findActiveNotDeletedByUser(userId);

    return {
      devices: devices.map((d) => this.toDeviceTokenResponse(d)),
      total: devices.length,
    };
  }

  /**
   * Unregister a device token (soft delete).
   */
  async unregisterDeviceToken(userId: string, token: string): Promise<void> {
    const deviceToken =
      await this.deviceTokenRepository.findFirstByUserAndTokenNotDeleted(
        userId,
        token,
      );

    if (!deviceToken) {
      throw new NotFoundException('Device token not found');
    }

    await this.deviceTokenRepository.updateById(deviceToken.id, {
      isActive: false,
      isDeleted: true,
      deletedAt: new Date(),
    });

    // Best-effort unsubscribe from broadcast topic
    this.pushProvider
      .unsubscribeFromTopic([token], 'all_users')
      .catch((err) =>
        this.logger.warn(
          `Failed to unsubscribe token from all_users: ${(err as Error).message}`,
        ),
      );

    this.logger.log(`Unregistered device token for user ${userId}`);
  }

  /**
   * Send a test push notification to verify setup.
   */
  async sendTestPush(
    userId: string,
    title: string,
    body: string,
    specificToken?: string,
  ): Promise<NotificationResult> {
    this.logger.log(
      `sendTestPush called for user=${userId.substring(0, 8)}, specificToken=${specificToken ? 'yes' : 'no'}, pushReady=${this.pushProvider.isReady()}`,
    );

    if (specificToken) {
      // Verify token ownership before sending
      const deviceToken =
        await this.deviceTokenRepository.findFirstByUserAndTokenNotDeleted(
          userId,
          specificToken,
        );

      if (!deviceToken) {
        this.logger.warn(
          `sendTestPush: token not found for user=${userId.substring(0, 8)}, hasToken=false`,
        );
        throw new NotFoundException(
          'Device token not found or does not belong to this user',
        );
      }

      this.logger.log(
        `sendTestPush: sending to specific token id=${deviceToken.id}, isActive=${deviceToken.isActive}`,
      );
      const result = await this.pushProvider.sendToTokens(
        [specificToken],
        title,
        body,
      );
      this.logger.log(
        `sendTestPush result: success=${result.success}, error=${result.error ?? 'none'}, messageId=${result.messageId ?? 'none'}`,
      );
      return result;
    }

    // Send to all user devices
    this.logger.log(
      `sendTestPush: sending to all devices for user=${userId.substring(0, 8)}`,
    );
    const result = await this.pushProvider.send({
      userId,
      category: PrismaCategory.SYSTEM_ALERT,
      title,
      body,
    });
    this.logger.log(
      `sendTestPush result: success=${result.success}, error=${result.error ?? 'none'}, messageId=${result.messageId ?? 'none'}`,
    );
    return result;
  }

  /**
   * Subscribe all existing active device tokens to the all_users topic.
   * Run once to seed existing devices. Processes in batches of 1000 (Firebase limit).
   */
  async subscribeAllExistingDevicesToTopic(
    topic: string = 'all_users',
  ): Promise<{ total: number; batches: number }> {
    const BATCH_SIZE = 1000;
    let cursor: string | undefined;
    let total = 0;
    let batches = 0;

    while (true) {
      const devices =
        await this.deviceTokenRepository.findActiveNotDeletedBatch({
          take: BATCH_SIZE,
          cursor,
        });

      if (devices.length === 0) break;

      const tokens = devices.map((d) => d.token);
      await this.pushProvider.subscribeToTopic(tokens, topic);
      batches++;
      total += tokens.length;
      cursor = devices[devices.length - 1].id;

      this.logger.log(
        `Subscribed batch ${batches} (${tokens.length} tokens) to topic: ${topic}`,
      );

      if (devices.length < BATCH_SIZE) break;
    }

    if (total === 0) {
      this.logger.log('No active device tokens to subscribe');
    } else {
      this.logger.log(
        `Finished subscribing ${total} tokens in ${batches} batches to topic: ${topic}`,
      );
    }

    return { total, batches };
  }

  /**
   * Handle a broadcast notification event by enqueuing a topic push.
   * Invoked by NotificationService's @OnEvent('notification.broadcast') listener.
   */
  async handleBroadcastNotification(payload: {
    topic: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    this.logger.log(
      `Handling broadcast event for topic "${payload.topic}": "${payload.title}"`,
    );
    try {
      const result = await this.pushQueueService.queueTopicPush(
        payload.topic,
        payload.title,
        payload.body,
        payload.data,
      );
      if (!result.queued) {
        throw new Error(
          `Broadcast enqueue returned queued=false (jobId=${result.jobId}): ${result.error ?? 'unknown error'}`,
        );
      }
      this.logger.log(`Broadcast queued: jobId=${result.jobId}`);
    } catch (err) {
      this.logger.error(
        `Failed to queue broadcast for topic "${payload.topic}": ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Re-throw so emitAsync in broadcastNotification can detect failure
      throw err;
    }
  }

  /**
   * Handle a seed-topic event by subscribing all existing devices to the topic.
   * Invoked by NotificationService's @OnEvent('notification.seed-topic') listener.
   */
  async handleSeedTopic(payload: { topic: string }): Promise<void> {
    this.logger.log(`Handling seed-topic event for topic "${payload.topic}"`);
    try {
      await this.subscribeAllExistingDevicesToTopic(payload.topic);
    } catch (err) {
      this.logger.error(
        `Failed to seed topic "${payload.topic}": ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /**
   * Check if push notifications are properly configured.
   */
  isPushReady(): boolean {
    return this.pushProvider.isReady();
  }

  private toDeviceTokenResponse(token: {
    id: string;
    userId: string;
    token: string;
    platform: string;
    deviceName: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): DeviceTokenResponseDto {
    return {
      id: token.id,
      userId: token.userId,
      // Mask token for security - show first 8 and last 4 chars
      token:
        token.token.length > 12
          ? `${token.token.substring(0, 8)}...${token.token.substring(token.token.length - 4)}`
          : token.token,
      platform: token.platform as DevicePlatform,
      deviceName: token.deviceName || undefined,
      isActive: token.isActive,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };
  }
}
