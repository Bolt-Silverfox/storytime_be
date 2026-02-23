import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SubscriptionService } from '@/subscription/subscription.service';
import {
  AppEvents,
  SubscriptionCreatedEvent,
  SubscriptionChangedEvent,
  SubscriptionCancelledEvent,
} from '@/shared/events';

/**
 * Listens to subscription lifecycle events and invalidates cached subscription data.
 * Decouples cache management from payment/subscription business logic.
 */
@Injectable()
export class SubscriptionCacheListener {
  private readonly logger = new Logger(SubscriptionCacheListener.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  @OnEvent(AppEvents.SUBSCRIPTION_CREATED)
  async onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
    await this.subscriptionService.invalidateCache(event.userId);
    this.logger.debug(
      `Cache invalidated for new subscription: user ${event.userId.substring(0, 8)}`,
    );
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CHANGED)
  async onSubscriptionChanged(event: SubscriptionChangedEvent): Promise<void> {
    await this.subscriptionService.invalidateCache(event.userId);
    this.logger.debug(
      `Cache invalidated for subscription change: user ${event.userId.substring(0, 8)}`,
    );
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CANCELLED)
  async onSubscriptionCancelled(
    event: SubscriptionCancelledEvent,
  ): Promise<void> {
    await this.subscriptionService.invalidateCache(event.userId);
    this.logger.debug(
      `Cache invalidated for subscription cancellation: user ${event.userId.substring(0, 8)}`,
    );
  }
}
