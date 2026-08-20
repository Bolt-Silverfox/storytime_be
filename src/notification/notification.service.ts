import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationCategory as PrismaCategory } from '@prisma/client';
import { Notifications } from './notification.registry';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  BulkUpdateNotificationPreferenceDto,
  NotificationPreferenceDto,
} from './dto/notification.dto';
import {
  NotificationPayload,
  NotificationResult,
} from './providers/notification-provider.interface';
import { QueuedEmailResult } from './queue/email-queue.service';
import {
  DeviceTokenResponseDto,
  DeviceTokenListResponseDto,
  DevicePlatform,
} from './dto/device-token.dto';
import { NotificationEmailService } from './services/notification-email.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationSettingsService } from './services/notification-settings.service';
import {
  NotificationDeviceService,
  BatchedBroadcastSummary,
} from './services/notification-device.service';
import { InAppNotificationService } from './services/in-app-notification.service';

export type { BatchedBroadcastSummary } from './services/notification-device.service';

/**
 * Thin facade over the notification module's focused services. Other modules
 * inject this class; its public method signatures are the module's stable API.
 * Each method delegates to a cohesive service:
 *  - dispatch (send*)              -> NotificationDispatchService
 *  - email (queue/send email)      -> NotificationEmailService
 *  - preferences/settings          -> NotificationSettingsService
 *  - device tokens / push / topics -> NotificationDeviceService
 *  - in-app notification reads      -> InAppNotificationService
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly emailService: NotificationEmailService,
    private readonly dispatchService: NotificationDispatchService,
    private readonly settingsService: NotificationSettingsService,
    private readonly deviceService: NotificationDeviceService,
    private readonly inAppNotificationService: InAppNotificationService,
  ) {}

  // ============================================
  // Notification dispatch
  // ============================================

  async sendNotification(
    type: Notifications,
    data: Record<string, unknown>,
    targetUserId?: string,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    return this.dispatchService.sendNotification(type, data, targetUserId);
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
    return this.dispatchService.sendViaProvider(payload, channels);
  }

  // ============================================
  // Email
  // ============================================

  /**
   * Queue an email for async delivery with automatic retries.
   * This is the RECOMMENDED method for sending emails.
   *
   * @param email Recipient email address
   * @param subject Email subject
   * @param htmlContent Rendered HTML content
   * @param options Optional: userId, category for tracking and priority
   */
  async queueEmail(
    email: string,
    subject: string,
    htmlContent: string,
    options?: {
      userId?: string;
      category?: PrismaCategory;
      templateName?: string;
    },
  ): Promise<QueuedEmailResult> {
    return this.emailService.queueEmail(email, subject, htmlContent, options);
  }

  /**
   * Send email synchronously (bypasses queue).
   * Use sparingly - only when immediate delivery confirmation is required.
   * For most cases, use queueEmail() instead.
   *
   * @deprecated Prefer queueEmail() for reliability with automatic retries
   */
  async sendEmailSync(
    email: string,
    subject: string,
    htmlContent: string,
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    return this.emailService.sendEmailSync(email, subject, htmlContent);
  }

  /**
   * Send email - now queues by default for reliability.
   * Returns immediately after queueing (non-blocking).
   *
   * @param email Recipient email address
   * @param subject Email subject
   * @param htmlContent Rendered HTML content
   * @param sync Set to true to send synchronously (not recommended)
   */
  async sendEmail(
    email: string,
    subject: string,
    htmlContent: string,
    sync: boolean = false,
  ): Promise<{
    success: boolean;
    messageId?: string;
    jobId?: string;
    error?: string;
  }> {
    return this.emailService.sendEmail(email, subject, htmlContent, sync);
  }

  // ============================================
  // Notification preferences (settings)
  // ============================================

  async create(
    dto: CreateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    return this.settingsService.create(dto);
  }

  async update(
    id: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    return this.settingsService.update(id, dto);
  }

  async bulkUpdate(
    userId: string,
    dtos: BulkUpdateNotificationPreferenceDto[],
  ): Promise<NotificationPreferenceDto[]> {
    return this.settingsService.bulkUpdate(userId, dtos);
  }

  async getForUser(userId: string): Promise<NotificationPreferenceDto[]> {
    return this.settingsService.getForUser(userId);
  }

  async getForKid(kidId: string): Promise<NotificationPreferenceDto[]> {
    return this.settingsService.getForKid(kidId);
  }

  async getById(id: string): Promise<NotificationPreferenceDto> {
    return this.settingsService.getById(id);
  }

  /**
   * Toggle a category preference for both in_app and push channels.
   * Used by the settings UI when the user toggles a category on/off.
   */
  async toggleCategoryPreference(
    userId: string,
    category: PrismaCategory,
    enabled: boolean,
  ): Promise<NotificationPreferenceDto[]> {
    return this.settingsService.toggleCategoryPreference(
      userId,
      category,
      enabled,
    );
  }

  /**
   * Get user preferences in grouped format.
   * Returns a map of category -> {push: bool, in_app: bool}.
   */
  async getUserPreferencesGrouped(
    userId: string,
  ): Promise<Record<string, { push: boolean; in_app: boolean }>> {
    return this.settingsService.getUserPreferencesGrouped(userId);
  }

  /**
   * Update user preferences in bulk. Each category update affects both push and in_app channels.
   * Example: { "NEW_STORY": true, "STORY_FINISHED": false }
   */
  async updateUserPreferences(
    userId: string,
    preferences: Record<string, boolean>,
  ): Promise<Record<string, { push: boolean; in_app: boolean }>> {
    return this.settingsService.updateUserPreferences(userId, preferences);
  }

  /**
   * Seed default notification preferences for a new user.
   * Creates preferences for all user-facing categories with enabled: true.
   * Called during user registration.
   */
  async seedDefaultPreferences(userId: string): Promise<void> {
    return this.settingsService.seedDefaultPreferences(userId);
  }

  /**
   * Soft delete or permanently delete a notification preference
   * @param id Notification preference ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async delete(id: string, permanent: boolean = false): Promise<void> {
    return this.settingsService.delete(id, permanent);
  }

  /**
   * Restore a soft deleted notification preference
   * @param id Notification preference ID
   */
  async undoDelete(id: string): Promise<NotificationPreferenceDto> {
    return this.settingsService.undoDelete(id);
  }

  // ============================================
  // In-app notifications
  // ============================================

  async getInAppNotifications(
    userId: string,
    limit: number = 20,
    offset: number = 0,
    unreadOnly: boolean = false,
  ) {
    return this.inAppNotificationService.getInAppNotifications(
      userId,
      limit,
      offset,
      unreadOnly,
    );
  }

  async markAsRead(userId: string, notificationIds: string[]) {
    return this.inAppNotificationService.markAsRead(userId, notificationIds);
  }

  async markAllAsRead(userId: string) {
    return this.inAppNotificationService.markAllAsRead(userId);
  }

  // ============================================
  // Device Token Management
  // ============================================

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
    return this.deviceService.registerDeviceToken(
      userId,
      token,
      platform,
      deviceName,
    );
  }

  /**
   * Get all active devices for a user.
   */
  async getUserDevices(userId: string): Promise<DeviceTokenListResponseDto> {
    return this.deviceService.getUserDevices(userId);
  }

  /**
   * Unregister a device token (soft delete).
   */
  async unregisterDeviceToken(userId: string, token: string): Promise<void> {
    return this.deviceService.unregisterDeviceToken(userId, token);
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
    return this.deviceService.sendTestPush(userId, title, body, specificToken);
  }

  /**
   * The environment-scoped FCM topic this backend broadcasts to and subscribes
   * devices to (e.g. `all_users_production`). Single source of truth; other
   * modules default to it instead of hardcoding a topic string.
   */
  getBroadcastTopic(): string {
    return this.deviceService.getBroadcastTopic();
  }

  /**
   * Subscribe all existing active device tokens to the broadcast topic.
   * Defaults to the env-scoped topic (`all_users_<NODE_ENV>`); overridable.
   * Run once to seed existing devices. Processes in batches of 1000 (Firebase limit).
   */
  async subscribeAllExistingDevicesToTopic(
    topic?: string,
  ): Promise<{ total: number; batches: number }> {
    return this.deviceService.subscribeAllExistingDevicesToTopic(topic);
  }

  /**
   * Broadcast a push to ALL active device tokens in staggered batches (<= 500
   * per FCM multicast call). Delegated to the device service.
   */
  async broadcastBatchedToAllDevices(payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    batchSize?: number;
    intervalSeconds?: number;
  }): Promise<BatchedBroadcastSummary> {
    return this.deviceService.broadcastBatchedToAllDevices(payload);
  }

  /**
   * Write an in-app inbox record for every active user (batched). Used by admin
   * broadcasts so an announcement lands in the in-app inbox, not just push.
   */
  async broadcastInAppToAllUsers(
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<{ delivered: number; failed: number }> {
    return this.inAppNotificationService.broadcastInAppToAllUsers(
      title,
      body,
      data,
    );
  }

  /**
   * Fan out a NewStory notification to every active user (batched, preference-
   * aware). Meant to be fire-and-forget from the story-create path.
   */
  async broadcastNewStoryToUsers(
    storyId: string,
    storyTitle: string,
  ): Promise<void> {
    return this.dispatchService.broadcastNewStoryToUsers(storyId, storyTitle);
  }

  // ============================================
  // Event Listeners (cross-module communication)
  // ============================================

  @OnEvent('notification.broadcast-batched')
  async handleBatchedBroadcastNotification(payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    batchSize?: number;
    intervalSeconds?: number;
  }): Promise<BatchedBroadcastSummary> {
    return this.deviceService.handleBatchedBroadcastNotification(payload);
  }

  @OnEvent('notification.broadcast')
  async handleBroadcastNotification(payload: {
    topic: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    return this.deviceService.handleBroadcastNotification(payload);
  }

  @OnEvent('notification.seed-topic')
  async handleSeedTopic(payload: { topic: string }): Promise<void> {
    return this.deviceService.handleSeedTopic(payload);
  }

  /**
   * Check if push notifications are properly configured.
   */
  isPushReady(): boolean {
    return this.deviceService.isPushReady();
  }
}
