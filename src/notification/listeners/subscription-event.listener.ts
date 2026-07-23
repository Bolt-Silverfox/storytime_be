import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppEvents, SubscriptionCancelledEvent } from '@/shared/events';
import { PLANS } from '@/subscription/subscription.constants';
import { NotificationService } from '../notification.service';

/**
 * Emits a SubscriptionAlert notification when a subscription is cancelled.
 *
 * Adapts green's direct SubscriptionAlert call (subscription.service cancel path)
 * to blue's event architecture: SubscriptionService already emits
 * AppEvents.SUBSCRIPTION_CANCELLED, so this listener reacts to it instead of
 * coupling the subscription module to NotificationService. Best-effort: never
 * throws (that would bubble back into the emitter).
 *
 * Note: the store-INITIATED webhook cancel path (subscription-webhook.service)
 * does not emit this event, and the app-initiated store cancel
 * (payment.service.cancelSubscription) notifies directly at that site.
 */
@Injectable()
export class SubscriptionEventListener {
  private readonly logger = new Logger(SubscriptionEventListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent(AppEvents.SUBSCRIPTION_CANCELLED)
  async handleSubscriptionCancelled(
    event: SubscriptionCancelledEvent,
  ): Promise<void> {
    try {
      const planDisplay = PLANS[event.planId]?.display ?? event.planId;
      await this.notificationService.sendNotification(
        'SubscriptionAlert',
        { message: `Your ${planDisplay} subscription was cancelled.` },
        event.userId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to emit SubscriptionAlert for user ${event.userId.substring(0, 8)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
