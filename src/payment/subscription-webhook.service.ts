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

/**
 * Maximum number of `linkedPurchaseToken` hops to follow when mapping a new
 * Google Play purchase token back to an existing Subscription. Bounds the work
 * per event and guards against a malformed/cyclic chain looping forever.
 */
const MAX_LINKED_TOKEN_HOPS = 5;

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

    const eventAt = this.appleEventAt(info);
    const applied = await this.applyAction(
      subscription,
      action,
      endsAt,
      eventAt,
    );
    if (!applied) {
      return {
        status: 'skipped',
        action: `apple:${info.notificationType} stale/out-of-order (event <= lastEventAt)`,
      };
    }
    return {
      status: 'processed',
      action: `apple:${info.notificationType} -> ${action}`,
    };
  }

  /**
   * Authoritative timestamp for an Apple notification, used as the out-of-order
   * watermark. Prefers the outer notification `signedDate`, then the signed
   * transaction/renewal `signedDate`. Returns `null` when none is present (then
   * ordering cannot be established and the event is applied without gating).
   */
  private appleEventAt(info: AppleNotificationInfo): Date | null {
    const candidates: unknown[] = [
      info.signedDate,
      info.transactionInfo?.signedDate,
      info.renewalInfo?.signedDate,
    ];
    for (const ms of candidates) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
        return new Date(ms);
      }
    }
    return null;
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new BadRequestException('Invalid JSON in Pub/Sub message data');
    }
    // `JSON.parse('null')` (and other non-object JSON) parses successfully;
    // reject it here so googleEventType() never dereferences a non-object and
    // turns malformed input into an unhandled 500 instead of a 400.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException(
        'Pub/Sub message data must be a JSON object',
      );
    }
    return parsed as GoogleRtdnPayload;
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
    const eventAt = this.googleEventAt(payload);

    // Voided purchase (refund/chargeback) -> revoke access.
    if (payload.voidedPurchaseNotification?.purchaseToken) {
      const sub = await this.findSubscription(
        'google',
        payload.voidedPurchaseNotification.purchaseToken,
      );
      if (!sub) {
        return { status: 'skipped', action: 'google:voided no subscription' };
      }
      const applied = await this.applyAction(sub, 'revoke', undefined, eventAt);
      if (!applied) {
        return {
          status: 'skipped',
          action: 'google:voided stale/out-of-order (event <= lastEventAt)',
        };
      }
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

    // Google issues a NEW purchase token on upgrade/downgrade/re-subscribe,
    // linked to the prior token via `linkedPurchaseToken`. Follow that chain so
    // events for the new token still resolve to the user's Subscription and
    // migrate the stored token forward.
    const subscription = await this.resolveGoogleSubscription(
      sub.purchaseToken,
      payload.packageName,
      sub.subscriptionId,
    );
    if (!subscription) {
      this.logger.warn(
        `No subscription for Google purchaseToken ${this.mask(sub.purchaseToken)} (linked-token chain unresolved)`,
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

    const applied = await this.applyAction(
      subscription,
      action,
      endsAt,
      eventAt,
    );
    if (!applied) {
      return {
        status: 'skipped',
        action: `google:SUBSCRIPTION_${sub.notificationType} stale/out-of-order (event <= lastEventAt)`,
      };
    }
    return {
      status: 'processed',
      action: `google:SUBSCRIPTION_${sub.notificationType} -> ${action}`,
    };
  }

  /**
   * Authoritative timestamp for a Google RTDN, used as the out-of-order
   * watermark. RTDN carries `eventTimeMillis` (epoch millis as a string).
   * Returns `null` when absent/malformed (then the event is applied without
   * ordering gating).
   */
  private googleEventAt(payload: GoogleRtdnPayload): Date | null {
    const raw = payload.eventTimeMillis;
    if (raw == null || raw === '') return null;
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
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
   * externalEventId) and runs `handler` exactly once, even under concurrent
   * duplicate deliveries.
   *
   * Idempotency is enforced by atomically CLAIMING the event row before running
   * the handler:
   *  - a terminal row (processed/skipped) -> idempotent replay, return 200;
   *  - a row currently `received` (another delivery in-flight) -> return 200
   *    without reprocessing;
   *  - only a delivery that actually creates the row, or that atomically flips a
   *    prior `failed` row back to `received`, owns the claim and runs `handler`.
   *
   * The claim uses the `(platform, externalEventId)` unique constraint (via
   * `create`) and a status-guarded `updateMany`, so two concurrent duplicate
   * deliveries can never both process. Success is only acknowledged after the
   * terminal status is durably committed.
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

    if (existing && existing.status === 'received') {
      // Another delivery of this exact event is already being processed. Do not
      // reprocess; ack 200 so the store stops retrying while the in-flight
      // delivery completes.
      this.logger.log(
        `Concurrent ${platform} webhook ${externalEventId} in-flight, skipping reprocess`,
      );
      return { duplicate: true, status: 'processed', action: 'duplicate' };
    }

    // No row, or a prior `failed` row we may retry. Atomically claim it.
    const event = await this.claimEvent(
      existing,
      platform,
      externalEventId,
      eventType,
      payload,
    );

    if (!event) {
      // Lost the claim race to a concurrent delivery; it owns processing.
      this.logger.log(
        `Lost claim race for ${platform} webhook ${externalEventId}, skipping reprocess`,
      );
      return { duplicate: true, status: 'processed', action: 'duplicate' };
    }

    try {
      const result = await handler();
      // Durably commit the terminal status BEFORE acknowledging success. If this
      // write fails it falls through to the catch below (recorded failed +
      // rethrown -> 5xx), so we never return 200 without a persisted outcome.
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: result.status,
          processedAt: new Date(),
          errorMessage: null,
        },
      });
      return { duplicate: false, status: result.status, action: result.action };
    } catch (error) {
      // Processing (or the terminal write) failed. Record it best-effort, then
      // rethrow so the store retries. Guard the bookkeeping so it cannot mask
      // `error`.
      await this.safeUpdateEvent(event.id, {
        status: 'failed',
        errorMessage: this.errorMessage(error).slice(0, 500),
      });
      throw error;
    }
  }

  /**
   * Atomically claim a webhook event for processing. Returns the claimed row, or
   * `null` when another concurrent delivery already owns it (so the caller must
   * not reprocess).
   */
  private async claimEvent(
    existing: { id: string; status: string } | null,
    platform: string,
    externalEventId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: string } | null> {
    // Retry of a prior `failed` row: flip failed -> received, guarded on status
    // so only one delivery wins.
    if (existing && existing.status === 'failed') {
      return this.claimFailedRow(existing.id);
    }

    const data = {
      platform,
      eventType,
      externalEventId,
      payload: payload as Prisma.InputJsonValue,
      status: 'received',
      errorMessage: null,
      processedAt: null,
    };

    try {
      return await this.prisma.webhookEvent.create({ data });
    } catch (error) {
      // Race: another delivery created the row between findUnique and create.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const now = await this.prisma.webhookEvent.findUnique({
          where: { platform_externalEventId: { platform, externalEventId } },
        });
        // The concurrent creator owns processing (received) or already finished
        // (processed/skipped). Only a `failed` row is eligible for a retry claim.
        if (now && now.status === 'failed') {
          return this.claimFailedRow(now.id);
        }
        return null;
      }
      throw error;
    }
  }

  /**
   * Claim a `failed` row for a retry by atomically flipping it to `received`.
   * The `status: 'failed'` guard means at most one concurrent delivery wins.
   */
  private async claimFailedRow(id: string): Promise<{ id: string } | null> {
    const res = await this.prisma.webhookEvent.updateMany({
      where: { id, status: 'failed' },
      data: { status: 'received', errorMessage: null, processedAt: null },
    });
    return res.count === 1 ? { id } : null;
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
   * Resolve the Subscription for a Google purchase token, following the
   * `linkedPurchaseToken` chain when the token is not directly known.
   *
   * Google mints a new purchase token on upgrade/downgrade/re-subscribe and
   * links it to the prior token. The first RTDN for the new token therefore has
   * no matching Subscription. We walk the chain (new -> ... -> old) via the Play
   * Developer API until we hit a token we already store, then migrate that row's
   * `purchaseToken` forward to the newest token (`eventToken`) so this and all
   * subsequent events resolve directly. Because `Subscription.userId` is unique
   * (one row per user) this is an in-place update, never a merge.
   *
   * Returns the (possibly migrated) Subscription, or `null` if the chain is
   * exhausted / capped without finding a known token.
   */
  private async resolveGoogleSubscription(
    eventToken: string,
    packageName: string | undefined,
    subscriptionId: string | undefined,
  ): Promise<Subscription | null> {
    // Fast path: the token is already stored.
    const direct = await this.findSubscription('google', eventToken);
    if (direct) return direct;

    // Follow linkedPurchaseToken hops. `subscriptionId` (productId) and
    // packageName are required to query the Play Developer API.
    if (!subscriptionId) return null;

    const visited = new Set<string>([eventToken]);
    let currentToken = eventToken;

    for (let hop = 0; hop < MAX_LINKED_TOKEN_HOPS; hop++) {
      const linkedToken = await this.fetchLinkedPurchaseToken(
        packageName,
        subscriptionId,
        currentToken,
      );

      // No further link, or a cycle -> give up.
      if (!linkedToken || visited.has(linkedToken)) return null;
      visited.add(linkedToken);

      const sub = await this.findSubscription('google', linkedToken);
      if (sub) {
        // Migrate the known row forward to the newest (event) token in place.
        const migrated = await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { purchaseToken: eventToken },
        });
        this.logger.log(
          `Migrated Google purchaseToken ${this.mask(linkedToken)} -> ${this.mask(eventToken)} for subscription ${sub.id} (${hop + 1} hop(s))`,
        );
        return migrated;
      }

      currentToken = linkedToken;
    }

    return null;
  }

  /**
   * Fetch a purchase token's `linkedPurchaseToken` via the Play Developer API.
   * Returns `null` on any error (verification failure, network) so the caller
   * can stop chasing the chain rather than crash the webhook.
   */
  private async fetchLinkedPurchaseToken(
    packageName: string | undefined,
    productId: string,
    purchaseToken: string,
  ): Promise<string | null> {
    try {
      const result = await this.googleVerification.verify({
        packageName,
        productId,
        purchaseToken,
      });
      return result.linkedPurchaseToken ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch linkedPurchaseToken for ${this.mask(purchaseToken)}: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Apply a normalized action to a subscription row.
   * - activate:       status active, extend endsAt (if a new expiry is known)
   * - will_not_renew: status cancelled, keep existing endsAt (access until expiry)
   * - deactivate:     status cancelled, endsAt = now (access ends immediately)
   * - revoke:         status cancelled, endsAt = now (refund/chargeback)
   *
   * Out-of-order protection: when `eventAt` is known and the subscription's
   * stored `lastEventAt` is >= `eventAt`, the event is stale (a late/duplicate
   * delivery) and the mutation is SKIPPED (returns `false`) so it cannot clobber
   * newer state. Otherwise the state change AND the advanced `lastEventAt`
   * watermark are written in a single update (atomic), and `true` is returned.
   */
  private async applyAction(
    subscription: Subscription,
    action: SubscriptionAction,
    endsAt?: Date | null,
    eventAt?: Date | null,
  ): Promise<boolean> {
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
        return false;
    }

    // Skip stale / out-of-order deliveries. `>=` also drops a distinct event
    // arriving at the exact same timestamp as the last applied one.
    if (
      eventAt &&
      subscription.lastEventAt &&
      subscription.lastEventAt.getTime() >= eventAt.getTime()
    ) {
      this.logger.log(
        `Skipping stale/out-of-order ${action} for subscription ${subscription.id} ` +
          `(event ${eventAt.toISOString()} <= lastEventAt ${subscription.lastEventAt.toISOString()})`,
      );
      return false;
    }

    // Advance the watermark atomically with the state change (same UPDATE).
    if (eventAt) {
      data.lastEventAt = eventAt;
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

    return true;
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
