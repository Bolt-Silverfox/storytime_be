import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationCategory as PrismaCategory } from '@prisma/client';
import { EnvConfig } from '@/shared/config/env.validation';
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

/** Summary returned by a batched (staggered) broadcast run. */
export interface BatchedBroadcastSummary {
  /** Total de-duplicated active device tokens targeted. */
  totalDevices: number;
  /** Number of push jobs enqueued (one per chunk of <= batchSize tokens). */
  batches: number;
  /** Batches successfully enqueued to BullMQ (these WILL deliver). */
  succeededBatches: number;
  /**
   * Batches that failed to enqueue. When this is > 0 but succeededBatches is
   * also > 0, the succeeded batches are already queued and will still fire —
   * do NOT blindly re-run the full broadcast, or the already-queued cohort is
   * double-delivered. Re-target only the failed cohort instead.
   */
  failedBatches: number;
  /** Effective chunk size after clamping to [1, 500]. */
  batchSize: number;
  /** Delay (seconds) before the final batch fires: (batches - 1) * intervalSeconds. */
  estimatedDurationSeconds: number;
}

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

  /**
   * Single source of truth for the environment-scoped FCM broadcast topic.
   *
   * dev/staging/prod share ONE Firebase project, and FCM topics are global to
   * the project. A hardcoded `all_users` topic therefore bleeds broadcasts
   * across environments (a dev broadcast reaches prod-subscribed devices).
   * Scoping the topic per environment (`all_users_<NODE_ENV>`) guarantees each
   * backend only ever subscribes/broadcasts to its OWN environment's topic.
   * `all_users_<env>` stays within the valid FCM topic charset
   * (`[a-zA-Z0-9-_.~%]+`).
   */
  private readonly broadcastTopic: string;

  /**
   * The legacy, un-scoped topic every device was historically subscribed to.
   * We no longer subscribe or broadcast to it; the re-seed migration also
   * unsubscribes existing devices from it so a manual override broadcast to
   * `all_users` can't reach cross-environment subscribers.
   */
  private readonly legacyBroadcastTopic = 'all_users';

  constructor(
    @Inject(DEVICE_TOKEN_REPOSITORY)
    private readonly deviceTokenRepository: IDeviceTokenRepository,
    private readonly pushProvider: PushProvider,
    private readonly pushQueueService: PushQueueService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {
    // Compute the environment-scoped broadcast topic once. Fall back to
    // 'development' when NODE_ENV is unset/empty, matching the env-validation
    // default so the topic is never `all_users_` (an invalid, unscoped value).
    const nodeEnv = this.configService.get('NODE_ENV') || 'development';
    this.broadcastTopic = `all_users_${nodeEnv}`;
  }

  /**
   * The environment-scoped FCM topic this backend broadcasts to and subscribes
   * devices to (e.g. `all_users_production`). Exposed so other modules (e.g.
   * AdminService) can default to it without duplicating the topic string.
   */
  getBroadcastTopic(): string {
    return this.broadcastTopic;
  }

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
        // Re-subscribe to the env-scoped broadcast topic (best-effort; don't fail token save on FCM side effects)
        this.pushProvider
          .subscribeToTopic([token], this.broadcastTopic)
          .catch((err) =>
            this.logger.warn(
              `Failed to subscribe updated token to ${this.broadcastTopic}: ${(err as Error).message}`,
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
      // Subscribe reassigned token to the env-scoped broadcast topic (best-effort)
      this.pushProvider
        .subscribeToTopic([token], this.broadcastTopic)
        .catch((err) =>
          this.logger.warn(
            `Failed to subscribe reassigned token to ${this.broadcastTopic}: ${(err as Error).message}`,
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
        .unsubscribeFromTopic(oldTokenStrings, this.broadcastTopic)
        .catch((err) =>
          this.logger.warn(
            `Failed to unsubscribe old tokens from ${this.broadcastTopic}: ${(err as Error).message}`,
          ),
        );
    }

    // Subscribe the new token to the env-scoped broadcast topic (best-effort; don't fail registration on FCM side effects)
    this.pushProvider
      .subscribeToTopic([token], this.broadcastTopic)
      .catch((err) =>
        this.logger.warn(
          `Failed to subscribe new token to ${this.broadcastTopic}: ${(err as Error).message}`,
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
      .unsubscribeFromTopic([token], this.broadcastTopic)
      .catch((err) =>
        this.logger.warn(
          `Failed to unsubscribe token from ${this.broadcastTopic}: ${(err as Error).message}`,
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
   * Subscribe all existing active device tokens to the broadcast topic.
   * Defaults to the env-scoped topic (`all_users_<NODE_ENV>`); overridable.
   * Run once to seed existing devices. Processes in batches of 1000 (Firebase limit).
   */
  async subscribeAllExistingDevicesToTopic(
    topic: string = this.broadcastTopic,
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

      // Migration cleanup: also unsubscribe this batch from the legacy global
      // `all_users` topic, so a manual broadcast that overrides
      // `topic: 'all_users'` can no longer reach stale cross-environment
      // subscribers. Skip if we're deliberately (re)seeding `all_users` itself.
      // Best-effort: a legacy-unsubscribe failure must not abort the re-seed.
      if (topic !== this.legacyBroadcastTopic) {
        try {
          await this.pushProvider.unsubscribeFromTopic(
            tokens,
            this.legacyBroadcastTopic,
          );
        } catch (err) {
          this.logger.warn(
            `Failed to unsubscribe batch ${batches + 1} from legacy topic ` +
              `${this.legacyBroadcastTopic}: ${(err as Error).message}`,
          );
        }
      }

      batches++;
      total += tokens.length;
      cursor = devices[devices.length - 1].id;

      this.logger.log(
        `Subscribed batch ${batches} (${tokens.length} tokens) to topic: ${topic}` +
          (topic !== this.legacyBroadcastTopic
            ? ` and unsubscribed from ${this.legacyBroadcastTopic}`
            : ''),
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
   * Broadcast a push to ALL active device tokens in staggered batches of
   * <= 500 tokens (the FCM multicast hard limit), instead of a single topic
   * fan-out. Batch i is delayed by `i * intervalSeconds` so users don't all
   * receive the push (and open the app) simultaneously — this protects the
   * connection-capped production RDS instance.
   *
   * Token reads reuse the exact same cursor pagination and active-token filter
   * as `subscribeAllExistingDevicesToTopic`. Tokens are de-duplicated before
   * chunking so a token never gets two pushes.
   */
  async broadcastBatchedToAllDevices(payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    batchSize?: number;
    intervalSeconds?: number;
  }): Promise<BatchedBroadcastSummary> {
    // Clamp to safe bounds; fall back to defaults for non-finite inputs (NaN /
    // Infinity) so a direct programmatic call can't produce NaN chunk sizes.
    const batchSize = Number.isFinite(payload.batchSize)
      ? Math.min(Math.max(payload.batchSize as number, 1), 500)
      : 500;
    const intervalSeconds = Number.isFinite(payload.intervalSeconds)
      ? Math.max(payload.intervalSeconds as number, 0)
      : 120;

    // Page ALL active device tokens using the same batching approach as
    // subscribeAllExistingDevicesToTopic (DB page size of 1000).
    const DB_PAGE_SIZE = 1000;
    let cursor: string | undefined;
    const uniqueTokens = new Set<string>();

    while (true) {
      const devices =
        await this.deviceTokenRepository.findActiveNotDeletedBatch({
          take: DB_PAGE_SIZE,
          cursor,
        });

      if (devices.length === 0) break;

      // De-duplicate tokens across pages so a token appearing twice is only
      // pushed once.
      for (const device of devices) {
        uniqueTokens.add(device.token);
      }
      cursor = devices[devices.length - 1].id;

      if (devices.length < DB_PAGE_SIZE) break;
    }

    const tokens = Array.from(uniqueTokens);
    const totalDevices = tokens.length;

    if (totalDevices === 0) {
      this.logger.warn(
        'Batched broadcast requested but no active device tokens were found; nothing queued',
      );
      return {
        totalDevices: 0,
        batches: 0,
        succeededBatches: 0,
        failedBatches: 0,
        batchSize,
        estimatedDurationSeconds: 0,
      };
    }

    // Split tokens into chunks of <= batchSize.
    const chunks: string[][] = [];
    for (let i = 0; i < tokens.length; i += batchSize) {
      chunks.push(tokens.slice(i, i + batchSize));
    }

    // The last batch fires after (batches - 1) intervals.
    const estimatedDurationSeconds = (chunks.length - 1) * intervalSeconds;

    this.logger.log(
      `Batched broadcast: ${totalDevices} device(s) -> ${chunks.length} batch(es) of <= ${batchSize} ` +
        `at ${intervalSeconds}s intervals (estimated duration ${estimatedDurationSeconds}s)`,
    );

    // One job per chunk, staggered: batch i is delayed by i * intervalSeconds.
    const enqueueResults = await Promise.all(
      chunks.map((chunk, index) =>
        this.pushQueueService.queueTokenBatch(
          chunk,
          payload.title,
          payload.body,
          payload.data,
          index * intervalSeconds * 1000,
        ),
      ),
    );

    // Partial-failure handling. queueTokenBatch never rejects — it returns
    // { queued: false } on error — so by the time we're here every SUCCEEDED
    // chunk is already enqueued in BullMQ and WILL fire.
    //   - all batches failed  -> nothing queued, a full retry is safe -> throw.
    //   - some batches failed  -> surface counts + warn; do NOT throw.
    const failed = enqueueResults.filter((r) => !r.queued);
    const failedBatches = failed.length;
    const succeededBatches = enqueueResults.length - failedBatches;

    if (failedBatches > 0) {
      const errs = failed.map((f) => f.error ?? 'unknown error').join('; ');
      if (succeededBatches === 0) {
        // Nothing was enqueued — safe to fail loudly so the caller can retry.
        throw new Error(
          `Batched broadcast failed to enqueue all ${failedBatches} batch(es): ${errs}`,
        );
      }
      // Partial success: some batches are already queued and will deliver.
      this.logger.warn(
        `Batched broadcast PARTIAL failure: ${succeededBatches}/${enqueueResults.length} batch(es) ` +
          `enqueued and WILL deliver; ${failedBatches} failed (${errs}). Do NOT re-run the full ` +
          `broadcast — that double-delivers to the already-queued cohort. Re-target only the failed batches.`,
      );
    }

    return {
      totalDevices,
      batches: chunks.length,
      succeededBatches,
      failedBatches,
      batchSize,
      estimatedDurationSeconds,
    };
  }

  /**
   * Handle a batched broadcast event by fanning out staggered per-token pushes.
   * Invoked by NotificationService's @OnEvent('notification.broadcast-batched').
   */
  async handleBatchedBroadcastNotification(payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    batchSize?: number;
    intervalSeconds?: number;
  }): Promise<BatchedBroadcastSummary> {
    this.logger.log(`Handling batched broadcast event: "${payload.title}"`);
    try {
      return await this.broadcastBatchedToAllDevices(payload);
    } catch (err) {
      this.logger.error(
        `Failed to run batched broadcast for "${payload.title}": ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Re-throw so emitAsync in the admin service can detect failure.
      throw err;
    }
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
