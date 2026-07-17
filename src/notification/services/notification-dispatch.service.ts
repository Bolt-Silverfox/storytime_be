import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NotificationCategory as PrismaCategory,
  NotificationType as PrismaNotificationType,
} from '@prisma/client';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  INotificationPreferenceRepository,
} from '../repositories';
import { NotificationRegistry, Notifications } from '../notification.registry';
import { InAppProvider } from '../providers/in-app.provider';
import { EmailProvider } from '../providers/email.provider';
import { PushProvider } from '../providers/push.provider';
import {
  INotificationProvider,
  NotificationPayload,
  NotificationResult,
} from '../providers/notification-provider.interface';

/**
 * Owns notification dispatch: resolving a registered notification type into a
 * payload, filtering channels by user preference, and fanning out to the
 * per-channel providers.
 *
 * Extracted verbatim from NotificationService to keep that class a thin facade;
 * behavior is intentionally identical.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);
  private providers: Map<string, INotificationProvider>;

  constructor(
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly notificationPreferenceRepository: INotificationPreferenceRepository,
    private readonly inAppProvider: InAppProvider,
    private readonly emailProvider: EmailProvider,
    private readonly pushProvider: PushProvider,
  ) {
    // Initialize provider registry
    this.providers = new Map<string, INotificationProvider>();
    this.providers.set('email', this.emailProvider);
    this.providers.set('in_app', this.inAppProvider);
    this.providers.set('push', this.pushProvider);
  }

  async sendNotification(
    type: Notifications,
    data: Record<string, unknown>,
    targetUserId?: string,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      const notification = NotificationRegistry[type];
      if (!notification) {
        throw new Error(`Invalid notification type: ${type}`);
      }

      const err = notification.validate(data);
      if (err) {
        throw new Error(`Validation failed for ${type}: ${err}`);
      }

      const template = await notification.getTemplate(data);

      const payload: NotificationPayload = {
        userId: targetUserId || (data.userId as string),
        category: notification.category,
        title: notification.subject,
        body: template,
        data: data,
      };

      // Map legacy medium to new channel
      let channels: string[] = ['in_app', 'push'];
      if (notification.medium === 'email') {
        channels = ['email'];
      }

      // Filter channels based on user preferences
      const userId = payload.userId;
      if (userId) {
        const enabledChannels = await this.getEnabledChannels(
          userId,
          notification.category,
          channels,
        );
        channels = enabledChannels;
      }

      if (channels.length === 0) {
        this.logger.log(
          `Notification ${type} skipped for user ${userId} - all channels disabled`,
        );
        return { success: true, messageId: 'skipped' };
      }

      const results = await this.sendViaProvider(payload, channels);

      const success = results.some((r) => r.success);
      return {
        success,
        messageId: results.find((r) => r.messageId)?.messageId,
        error: results.find((r) => !r.success)?.error,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to send notification: ${errorMessage}`,
        errorStack,
      );
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send notification via specified provider(s)
   * This is the new provider-based notification API
   * @param payload Notification payload
   * @param channels Array of channels to send through (email, in_app, push)
   */
  async sendViaProvider(
    payload: NotificationPayload,
    channels: string[] = ['in_app'],
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const channel of channels) {
      const provider = this.providers.get(channel);
      if (!provider) {
        this.logger.warn(`Provider for channel '${channel}' not found`);
        results.push({
          success: false,
          error: `Provider for channel '${channel}' not found`,
        });
        continue;
      }

      try {
        const result = await provider.send(payload);
        results.push(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;

        this.logger.error(
          `Failed to send via ${channel}: ${errorMessage}`,
          errorStack,
        );
        results.push({
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Get enabled channels for a user based on their notification preferences.
   * Uses opt-out model: if no preference exists, the channel is enabled by default.
   */
  private async getEnabledChannels(
    userId: string,
    category: PrismaCategory,
    requestedChannels: string[],
  ): Promise<string[]> {
    // Map string channels to NotificationType enum
    const channelToType: Record<string, PrismaNotificationType> = {
      email: PrismaNotificationType.email,
      push: PrismaNotificationType.push,
      in_app: PrismaNotificationType.in_app,
    };

    const preferences =
      await this.notificationPreferenceRepository.findManyByUserCategoryAndTypes(
        userId,
        category,
        requestedChannels
          .map((c) => channelToType[c])
          .filter((t) => t !== undefined),
      );

    // Create a map of channel -> enabled status
    const prefMap = new Map<string, boolean>();
    for (const pref of preferences) {
      const channelName = Object.entries(channelToType).find(
        ([, v]) => v === pref.type,
      )?.[0];
      if (channelName) {
        prefMap.set(channelName, pref.enabled);
      }
    }

    // Filter channels: include if preference doesn't exist (opt-out) OR if enabled
    return requestedChannels.filter((channel) => {
      const enabled = prefMap.get(channel);
      return enabled === undefined || enabled === true;
    });
  }
}
