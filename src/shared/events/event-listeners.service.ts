import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AppEvents,
  UserRegisteredEvent,
  UserDeletedEvent,
  StoryCreatedEvent,
  StoryCompletedEvent,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  SubscriptionCreatedEvent,
  SubscriptionChangedEvent,
  SubscriptionCancelledEvent,
  KidCreatedEvent,
  KidDeletedEvent,
  QuotaExhaustedEvent,
} from './app-events';

/**
 * Global event listeners for cross-cutting concerns.
 *
 * This service handles application-wide event logging and can be extended
 * for analytics tracking, audit logging, and other observability needs.
 *
 * For domain-specific event handling (e.g., sending notifications on story completion),
 * create dedicated listeners in the relevant module.
 */
@Injectable()
export class EventListenersService {
  private readonly logger = new Logger(EventListenersService.name);

  // =============================================================================
  // USER LIFECYCLE EVENTS
  // =============================================================================

  @OnEvent(AppEvents.USER_REGISTERED)
  handleUserRegistered(event: UserRegisteredEvent): void {
    this.logger.log(
      `User registered: ${event.userId} (${event.email}) as ${event.role}`,
    );
    // Future: Analytics tracking, welcome email trigger, etc.
  }

  @OnEvent(AppEvents.USER_DELETED)
  handleUserDeleted(event: UserDeletedEvent): void {
    this.logger.log(
      `User deleted: ${event.userId} (${event.email})${event.reason ? ` - Reason: ${event.reason}` : ''}`,
    );
    // Future: Data retention audit, GDPR compliance logging, etc.
  }

  // =============================================================================
  // KID LIFECYCLE EVENTS
  // =============================================================================

  @OnEvent(AppEvents.KID_CREATED)
  handleKidCreated(event: KidCreatedEvent): void {
    this.logger.log(
      `Kid profile created: ${event.kidId} (${event.name ?? 'unnamed'}) for parent ${event.parentId}`,
    );
    // Future: Analytics, onboarding triggers, etc.
  }

  @OnEvent(AppEvents.KID_DELETED)
  handleKidDeleted(event: KidDeletedEvent): void {
    this.logger.log(
      `Kid profile deleted: ${event.kidId} for parent ${event.parentId}`,
    );
    // Future: Data cleanup, analytics, etc.
  }

  // =============================================================================
  // STORY LIFECYCLE EVENTS
  // =============================================================================

  @OnEvent(AppEvents.STORY_CREATED)
  handleStoryCreated(event: StoryCreatedEvent): void {
    this.logger.log(
      `Story created: ${event.storyId} - "${event.title}" (AI: ${event.aiGenerated})`,
    );
    // Future: Content moderation queue, analytics, etc.
  }

  @OnEvent(AppEvents.STORY_COMPLETED)
  handleStoryCompleted(event: StoryCompletedEvent): void {
    const identifier = event.kidId
      ? `kid ${event.kidId}`
      : `user ${event.userId}`;
    this.logger.log(
      `Story completed: ${event.storyId} by ${identifier} - ${event.totalTimeSpent}s`,
    );
    // Future: Achievement progress triggers, engagement analytics, etc.
  }

  // =============================================================================
  // PAYMENT & SUBSCRIPTION EVENTS
  // =============================================================================

  @OnEvent(AppEvents.PAYMENT_COMPLETED)
  handlePaymentCompleted(event: PaymentCompletedEvent): void {
    this.logger.log(
      `Payment completed: ${event.paymentId} - ${event.amount} ${event.currency} via ${event.provider} for user ${event.userId}`,
    );
    // Future: Revenue analytics, receipt generation trigger, etc.
  }

  @OnEvent(AppEvents.PAYMENT_FAILED)
  handlePaymentFailed(event: PaymentFailedEvent): void {
    this.logger.warn(
      `Payment failed for user ${event.userId}: ${event.errorCode ?? 'unknown'} - ${event.errorMessage ?? 'No message'}`,
    );
    // Future: Alert system, retry logic trigger, customer support notification, etc.
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CREATED)
  handleSubscriptionCreated(event: SubscriptionCreatedEvent): void {
    this.logger.log(
      `Subscription created: ${event.subscriptionId} - ${event.planName} for user ${event.userId} via ${event.provider}`,
    );
    // Future: Welcome to premium flow, feature unlock, etc.
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CHANGED)
  handleSubscriptionChanged(event: SubscriptionChangedEvent): void {
    this.logger.log(
      `Subscription ${event.changeType}: ${event.subscriptionId} - ${event.previousPlanName} → ${event.newPlanName} for user ${event.userId}`,
    );
    // Future: Plan change notifications, feature adjustment, etc.
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CANCELLED)
  handleSubscriptionCancelled(event: SubscriptionCancelledEvent): void {
    this.logger.log(
      `Subscription cancelled: ${event.subscriptionId} for user ${event.userId}${event.reason ? ` - Reason: ${event.reason}` : ''}`,
    );
    // Future: Churn analytics, win-back campaign trigger, etc.
  }

  // =============================================================================
  // QUOTA EVENTS
  // =============================================================================

  @OnEvent(AppEvents.QUOTA_EXHAUSTED)
  handleQuotaExhausted(event: QuotaExhaustedEvent): void {
    this.logger.log(
      `Quota exhausted: ${event.quotaType} for user ${event.userId} (${event.used}/${event.limit})`,
    );
    // Future: Upgrade prompt notification, analytics for conversion optimization, etc.
  }
}
