import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Subscription } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  AppleNotificationInfo,
  AppleVerificationService,
} from './apple-verification.service';
import { GoogleVerificationService } from './google-verification.service';
import { AppleWebhookDto, GoogleWebhookDto } from './dto/webhook.dto';

/** Outcome of processing a single webhook notification. */
export interface WebhookProcessResult {
  /** true when the event had already been processed (idempotent replay). */
  duplicate: boolean;
  /** Final WebhookEvent status. */
  status: 'processed' | 'skipped';
  /** Human-readable description of the action taken. */
  action: string;
}

/** Normalized subscription state transition applied to a Subscription row. */
type SubscriptionAction =
  | 'activate' // renew/recover/subscribe -> active, extend endsAt
  | 'will_not_renew' // auto-renew off / user cancel -> keep access until endsAt
  | 'deactivate' // expired / on-hold -> access ends now
  | 'revoke' // refund / revoke -> access ends now
  | 'noop'; // acknowledged but no state change

/**
 * Google Play RTDN subscription notification types.
 * @see https://developer.android.com/google/play/billing/rtdn-reference#sub
 */
const GOOGLE_SUB_TYPE = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  PRICE_CHANGE_CONFIRMED: 8,
  DEFERRED: 9,
  PAUSED: 10,
  PAUSE_SCHEDULE_CHANGED: 11,
  REVOKED: 12,
  EXPIRED: 13,
} as const;

interface GoogleRtdnPayload {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  voidedPurchaseNotification?: {
    purchaseToken?: string;
    orderId?: string;
    productType?: number;
    refundType?: number;
  };
  oneTimeProductNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    sku?: string;
  };
  testNotification?: { version?: string };
}

/**
 * Processes Apple App Store Server Notifications (ASSN v2) and Google Play
 * Real-time Developer Notifications (RTDN), mapping platform notification types
 * to subscription state changes. Every notification is recorded in the
 * `webhook_events` table for idempotency and auditing.
 */
@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appleVerification: AppleVerificationService,
    private readonly googleVerification: GoogleVerificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Apple
  // ---------------------------------------------------------------------------

  /**
   * Handle an Apple ASSN v2 notification. Signature verification happens here
   * and throws (400) for malformed/forged payloads, so those never reach the
   * idempotency layer.
   */
  async handleApple(dto: AppleWebhookDto): Promise<WebhookProcessResult> {
    // Verify + decode. Throws HttpException(400) on bad signature/payload.
    const info = this.appleVerification.parseSignedNotification(
      dto.signedPayload,
    );

    return this.processWithIdempotency(
      'apple',
      info.notificationUUID,
      info.notificationType,
      info.raw,
      () => this.applyAppleNotification(info),
    );
  }

  private async applyAppleNotification(
    info: AppleNotificationInfo,
  ): Promise<{ status: 'processed' | 'skipped'; action: string }> {
    const { action, endsAt } = this.mapAppleAction(info);

    if (action === 'noop') {
      return {
        status: 'skipped',
        action: `apple:${info.notificationType}${info.subtype ? `/${info.subtype}` : ''} ignored`,
      };
    }

    const originalTransactionId =
      info.transactionInfo?.originalTransactionId ??
      info.renewalInfo?.originalTransactionId;

    if (!originalTransactionId) {
      return {
        status: 'skipped',
        action: `apple:${info.notificationType} missing originalTransactionId`,
      };
    }

    const subscription = await this.findSubscription(
      'apple',
      originalTransactionId,
    );

    if (!subscription) {
      this.logger.warn(
        `No subscription for Apple originalTransactionId ${this.mask(originalTransactionId)}`,
      );
      return {
        status: 'skipped',
        action: `apple:${info.notificationType} no matching subscription`,
      };
    }

    await this.applyAction(subscription, action, endsAt);
    return {
      status: 'processed',
      action: `apple:${info.notificationType} -> ${action}`,
    };
  }

  private mapAppleAction(info: AppleNotificationInfo): {
    action: SubscriptionAction;
    endsAt?: Date | null;
  } {
    const expiresDate = info.transactionInfo?.expiresDate
      ? new Date(info.transactionInfo.expiresDate)
      : null;

    switch (info.notificationType) {
      case 'SUBSCRIBED':
      case 'DID_RENEW':
      case 'OFFER_REDEEMED':
        return { action: 'activate', endsAt: expiresDate };

      case 'DID_CHANGE_RENEWAL_STATUS':
        // AUTO_RENEW_DISABLED -> will not renew; AUTO_RENEW_ENABLED -> re-activated.
        if (info.subtype === 'AUTO_RENEW_ENABLED') {
          return { action: 'activate', endsAt: expiresDate };
        }
        return { action: 'will_not_renew' };

      case 'EXPIRED':
      case 'GRACE_PERIOD_EXPIRED':
        return { action: 'deactivate' };

      case 'REFUND':
      case 'REVOKE':
        return { action: 'revoke' };

      default:
        // DID_CHANGE_RENEWAL_PREF, PRICE_INCREASE, RENEWAL_EXTENDED,
        // DID_FAIL_TO_RENEW, CONSUMPTION_REQUEST, TEST, etc.
        return { action: 'noop' };
    }
  }

  // ---------------------------------------------------------------------------
  // Google
  // ---------------------------------------------------------------------------

  /**
   * Handle a Google Play RTDN delivered via a Pub/Sub push message.
   */
  async handleGoogle(dto: GoogleWebhookDto): Promise<WebhookProcessResult> {
    const messageId = dto.message?.messageId;
    if (!messageId) {
      throw new BadRequestException('Missing Pub/Sub messageId');
    }
    if (!dto.message?.data) {
      throw new BadRequestException('Missing Pub/Sub message data');
    }

    const payload = this.decodeGooglePayload(dto.message.data);

    const eventType = this.googleEventType(payload);

    return this.processWithIdempotency(
      'google',
      messageId,
      eventType,
      payload as unknown as Record<string, unknown>,
      () => this.applyGoogleNotification(payload),
    );
  }

  private decodeGooglePayload(data: string): GoogleRtdnPayload {
    const json = Buffer.from(data, 'base64').toString('utf8');
    try {
      return JSON.parse(json) as GoogleRtdnPayload;
    } catch {
      throw new BadRequestException('Invalid JSON in Pub/Sub message data');
    }
  }

  private googleEventType(payload: GoogleRtdnPayload): string {
    if (payload.subscriptionNotification) {
      return `SUBSCRIPTION_${payload.subscriptionNotification.notificationType ?? 'UNKNOWN'}`;
    }
    if (payload.voidedPurchaseNotification) {
      return 'VOIDED_PURCHASE';
    }
    if (payload.oneTimeProductNotification) {
      return 'ONE_TIME_PRODUCT';
    }
    if (payload.testNotification) {
      return 'TEST';
    }
    return 'UNKNOWN';
  }

  private async applyGoogleNotification(
    payload: GoogleRtdnPayload,
  ): Promise<{ status: 'processed' | 'skipped'; action: string }> {
    // Voided purchase (refund/chargeback) -> revoke access.
    if (payload.voidedPurchaseNotification?.purchaseToken) {
      const sub = await this.findSubscription(
        'google',
        payload.voidedPurchaseNotification.purchaseToken,
      );
      if (!sub) {
        return { status: 'skipped', action: 'google:voided no subscription' };
      }
      await this.applyAction(sub, 'revoke');
      return { status: 'processed', action: 'google:voided -> revoke' };
    }

    const sub = payload.subscriptionNotification;
    if (!sub?.purchaseToken || sub.notificationType == null) {
      // One-time products / test notifications are not subscription state.
      return {
        status: 'skipped',
        action: `google:${this.googleEventType(payload)} ignored`,
      };
    }

    const action = this.mapGoogleAction(sub.notificationType);
    if (action === 'noop') {
      return {
        status: 'skipped',
        action: `google:SUBSCRIPTION_${sub.notificationType} ignored`,
      };
    }

    const subscription = await this.findSubscription(
      'google',
      sub.purchaseToken,
    );
    if (!subscription) {
      this.logger.warn(
        `No subscription for Google purchaseToken ${this.mask(sub.purchaseToken)}`,
      );
      return {
        status: 'skipped',
        action: `google:SUBSCRIPTION_${sub.notificationType} no matching subscription`,
      };
    }

    // Enrich with the Play Developer API to get the authoritative expiry.
    let endsAt: Date | null | undefined;
    if (action === 'activate') {
      endsAt = await this.fetchGoogleExpiry(
        payload.packageName,
        sub.subscriptionId ?? subscription.productId ?? '',
        sub.purchaseToken,
      );
    }

    await this.applyAction(subscription, action, endsAt);
    return {
      status: 'processed',
      action: `google:SUBSCRIPTION_${sub.notificationType} -> ${action}`,
    };
  }

  private mapGoogleAction(type: number): SubscriptionAction {
    switch (type) {
      case GOOGLE_SUB_TYPE.RECOVERED:
      case GOOGLE_SUB_TYPE.RENEWED:
      case GOOGLE_SUB_TYPE.PURCHASED:
      case GOOGLE_SUB_TYPE.RESTARTED:
      case GOOGLE_SUB_TYPE.IN_GRACE_PERIOD:
        // Grace period: user still has access while Google retries billing.
        return 'activate';

      case GOOGLE_SUB_TYPE.CANCELED:
        return 'will_not_renew';

      case GOOGLE_SUB_TYPE.ON_HOLD:
      case GOOGLE_SUB_TYPE.EXPIRED:
        return 'deactivate';

      case GOOGLE_SUB_TYPE.REVOKED:
        return 'revoke';

      default:
        // PRICE_CHANGE_CONFIRMED, DEFERRED, PAUSED, PAUSE_SCHEDULE_CHANGED
        return 'noop';
    }
  }

  private async fetchGoogleExpiry(
    packageName: string | undefined,
    productId: string,
    purchaseToken: string,
  ): Promise<Date | null | undefined> {
    if (!productId) return undefined;
    try {
      const result = await this.googleVerification.verify({
        packageName,
        productId,
        purchaseToken,
      });
      return result.expirationTime ?? undefined;
    } catch (error) {
      this.logger.warn(
        `Google Play enrichment failed: ${this.errorMessage(error)}`,
      );
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Shared: idempotency + state transitions
  // ---------------------------------------------------------------------------

  /**
   * Records the notification in `webhook_events` (keyed by platform +
   * externalEventId) and runs `handler` exactly once. Duplicate deliveries of
   * an already-processed/skipped event short-circuit and return 200.
   *
   * The WebhookEvent bookkeeping is wrapped in its own try/catch so a failure
   * writing the audit row never masks the original processing error.
   */
  private async processWithIdempotency(
    platform: 'apple' | 'google',
    externalEventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    handler: () => Promise<{ status: 'processed' | 'skipped'; action: string }>,
  ): Promise<WebhookProcessResult> {
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { platform_externalEventId: { platform, externalEventId } },
    });

    if (
      existing &&
      (existing.status === 'processed' || existing.status === 'skipped')
    ) {
      this.logger.log(
        `Duplicate ${platform} webhook ${externalEventId} (${existing.status}), skipping reprocess`,
      );
      return {
        duplicate: true,
        status: existing.status,
        action: 'duplicate',
      };
    }

    // Create (or reset) the audit row in "received" state.
    const event = await this.upsertReceived(
      existing?.id ?? null,
      platform,
      externalEventId,
      eventType,
      payload,
    );

    try {
      const result = await handler();
      await this.safeUpdateEvent(event.id, {
        status: result.status,
        processedAt: new Date(),
        errorMessage: null,
      });
      return { duplicate: false, status: result.status, action: result.action };
    } catch (error) {
      // Processing failed (e.g. transient DB error). Record it, then rethrow so
      // the store retries. Guard the bookkeeping so it cannot mask `error`.
      await this.safeUpdateEvent(event.id, {
        status: 'failed',
        errorMessage: this.errorMessage(error).slice(0, 500),
      });
      throw error;
    }
  }

  private async upsertReceived(
    id: string | null,
    platform: string,
    externalEventId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    const data = {
      platform,
      eventType,
      externalEventId,
      payload: payload as Prisma.InputJsonValue,
      status: 'received',
      errorMessage: null,
      processedAt: null,
    };

    if (id) {
      return this.prisma.webhookEvent.update({ where: { id }, data });
    }

    try {
      return await this.prisma.webhookEvent.create({ data });
    } catch (error) {
      // Race: another delivery created it between findUnique and create.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.prisma.webhookEvent.update({
          where: { platform_externalEventId: { platform, externalEventId } },
          data,
        });
      }
      throw error;
    }
  }

  private async safeUpdateEvent(
    id: string,
    data: Prisma.WebhookEventUpdateInput,
  ): Promise<void> {
    try {
      await this.prisma.webhookEvent.update({ where: { id }, data });
    } catch (error) {
      this.logger.error(
        `Failed to update webhook_event ${id}: ${this.errorMessage(error)}`,
      );
    }
  }

  private async findSubscription(
    platform: 'apple' | 'google',
    purchaseToken: string,
  ): Promise<Subscription | null> {
    return this.prisma.subscription.findFirst({
      where: { platform, purchaseToken },
    });
  }

  /**
   * Apply a normalized action to a subscription row.
   * - activate:       status active, extend endsAt (if a new expiry is known)
   * - will_not_renew: status cancelled, keep existing endsAt (access until expiry)
   * - deactivate:     status cancelled, endsAt = now (access ends immediately)
   * - revoke:         status cancelled, endsAt = now (refund/chargeback)
   */
  private async applyAction(
    subscription: Subscription,
    action: SubscriptionAction,
    endsAt?: Date | null,
  ): Promise<void> {
    const now = new Date();
    let data: Prisma.SubscriptionUpdateInput;

    switch (action) {
      case 'activate':
        data = {
          status: 'active',
          endsAt: endsAt ?? subscription.endsAt ?? undefined,
        };
        break;
      case 'will_not_renew':
        data = { status: 'cancelled' };
        break;
      case 'deactivate':
      case 'revoke':
        data = { status: 'cancelled', endsAt: now };
        break;
      case 'noop':
      default:
        return;
    }

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data,
    });

    this.eventEmitter.emit('admin.sse.activity', {
      type: 'SUBSCRIPTION',
      userId: subscription.userId,
      timestamp: now.toISOString(),
    });
    this.eventEmitter.emit('admin.sse.stats', {
      trigger: `webhook_${action}`,
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /** Mask a token/identifier for safe logging. */
  private mask(value: string): string {
    if (value.length <= 8) return '***';
    return `${value.slice(0, 6)}...${value.slice(-2)}`;
  }
}
