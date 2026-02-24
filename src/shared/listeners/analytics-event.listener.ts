import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AppEvents,
  UserRegisteredEvent,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  SubscriptionCreatedEvent,
  SubscriptionChangedEvent,
  SubscriptionCancelledEvent,
  StoryCreatedEvent,
  StoryCompletedEvent,
} from '@/shared/events';

/**
 * Event listener for tracking analytics and business metrics.
 * This centralizes all analytics tracking in one place.
 *
 * Future: Integrate with analytics platforms like Mixpanel, Amplitude, or Google Analytics
 */
@Injectable()
export class AnalyticsEventListener {
  private readonly logger = new Logger(AnalyticsEventListener.name);

  /**
   * Track new user registrations
   */
  @OnEvent(AppEvents.USER_REGISTERED)
  handleUserRegistered(payload: UserRegisteredEvent) {
    this.logger.log(`📊 Analytics: User registered - ${payload.email}`);
    // Future: Track in analytics platform
    // await this.analytics.track('User Registered', {
    //   userId: payload.userId,
    //   email: payload.email,
    //   role: payload.role,
    // });
  }

  /**
   * Track successful payments
   */
  @OnEvent(AppEvents.PAYMENT_COMPLETED)
  handlePaymentCompleted(payload: PaymentCompletedEvent) {
    this.logger.log(
      `📊 Analytics: Payment completed - $${payload.amount} ${payload.currency} via ${payload.provider}`,
    );
    // Future: Track revenue in analytics platform
    // await this.analytics.track('Payment Completed', {
    //   userId: payload.userId,
    //   amount: payload.amount,
    //   currency: payload.currency,
    //   provider: payload.provider,
    // });
  }

  /**
   * Track failed payments for conversion optimization
   */
  @OnEvent(AppEvents.PAYMENT_FAILED)
  handlePaymentFailed(payload: PaymentFailedEvent) {
    this.logger.log(
      `📊 Analytics: Payment failed - ${payload.errorMessage || 'Unknown error'}`,
    );
    // Future: Track payment failures for analysis
    // await this.analytics.track('Payment Failed', {
    //   userId: payload.userId,
    //   amount: payload.amount,
    //   provider: payload.provider,
    //   errorCode: payload.errorCode,
    // });
  }

  /**
   * Track new subscriptions
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CREATED)
  handleSubscriptionCreated(payload: SubscriptionCreatedEvent) {
    this.logger.log(
      `📊 Analytics: Subscription created - ${payload.planName} for user ${payload.userId.substring(0, 8)}`,
    );
    // Future: Track subscription conversions
    // await this.analytics.track('Subscription Created', {
    //   userId: payload.userId,
    //   planId: payload.planId,
    //   planName: payload.planName,
    //   provider: payload.provider,
    // });
  }

  /**
   * Track subscription changes (upgrades/downgrades)
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CHANGED)
  handleSubscriptionChanged(payload: SubscriptionChangedEvent) {
    this.logger.log(
      `📊 Analytics: Subscription ${payload.changeType} - ${payload.previousPlanName} → ${payload.newPlanName}`,
    );
    // Future: Track plan changes
    // await this.analytics.track('Subscription Changed', {
    //   userId: payload.userId,
    //   changeType: payload.changeType,
    //   previousPlan: payload.previousPlanName,
    //   newPlan: payload.newPlanName,
    // });
  }

  /**
   * Track subscription cancellations for churn analysis
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CANCELLED)
  handleSubscriptionCancelled(payload: SubscriptionCancelledEvent) {
    this.logger.log(
      `📊 Analytics: Subscription cancelled - ${payload.planId} (reason: ${payload.reason || 'not specified'})`,
    );
    // Future: Track churn for retention analysis
    // await this.analytics.track('Subscription Cancelled', {
    //   userId: payload.userId,
    //   planId: payload.planId,
    //   reason: payload.reason,
    // });
  }

  /**
   * Track story creation (especially AI-generated stories)
   */
  @OnEvent(AppEvents.STORY_CREATED)
  handleStoryCreated(payload: StoryCreatedEvent) {
    const generationType = payload.aiGenerated ? 'AI-generated' : 'Manual';
    this.logger.log(
      `📊 Analytics: Story created - "${payload.title}" (${generationType})`,
    );
    // Future: Track content creation metrics
    // await this.analytics.track('Story Created', {
    //   storyId: payload.storyId,
    //   aiGenerated: payload.aiGenerated,
    //   creatorKidId: payload.creatorKidId,
    // });
  }

  /**
   * Track story completions for engagement metrics
   */
  @OnEvent(AppEvents.STORY_COMPLETED)
  handleStoryCompleted(payload: StoryCompletedEvent) {
    const identifier = payload.kidId
      ? `kid ${payload.kidId.substring(0, 8)}`
      : `user ${payload.userId?.substring(0, 8)}`;
    this.logger.log(
      `📊 Analytics: Story completed by ${identifier} - ${payload.totalTimeSpent}s`,
    );
    // Future: Track engagement metrics
    // await this.analytics.track('Story Completed', {
    //   storyId: payload.storyId,
    //   kidId: payload.kidId,
    //   userId: payload.userId,
    //   totalTimeSpent: payload.totalTimeSpent,
    // });
  }
}
