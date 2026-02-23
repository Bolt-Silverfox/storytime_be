import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import {
  AppEvents,
  AiUsageTrackedEvent,
  UserRegisteredEvent,
  UserDeletedEvent,
  UserEmailVerifiedEvent,
  UserPasswordChangedEvent,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  SubscriptionCreatedEvent,
  SubscriptionChangedEvent,
  SubscriptionCancelledEvent,
} from '@/shared/events';

/**
 * Event listener for logging important user activities to the database.
 * This provides an audit trail of significant user actions.
 */
@Injectable()
export class ActivityLogEventListener {
  private readonly logger = new Logger(ActivityLogEventListener.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shared helper to create an activity log entry with error handling.
   */
  private async logActivity(
    userId: string,
    action: string,
    details: string,
    status: 'SUCCESS' | 'FAILED' = 'SUCCESS',
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: { userId, action, status, details },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log activity "${action}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Log user registration
   */
  @OnEvent(AppEvents.USER_REGISTERED)
  async handleUserRegistered(payload: UserRegisteredEvent) {
    await this.logActivity(
      payload.userId,
      'USER_REGISTERED',
      `User registered: ${payload.email}`,
    );
  }

  /**
   * Log user deletion
   */
  @OnEvent(AppEvents.USER_DELETED)
  async handleUserDeleted(payload: UserDeletedEvent) {
    await this.logActivity(
      payload.userId,
      'USER_DELETED',
      `User deleted: ${payload.email} (reason: ${payload.reason || 'not specified'})`,
    );
  }

  /**
   * Log email verification
   */
  @OnEvent(AppEvents.USER_EMAIL_VERIFIED)
  async handleEmailVerified(payload: UserEmailVerifiedEvent) {
    await this.logActivity(
      payload.userId,
      'EMAIL_VERIFIED',
      `Email verified: ${payload.email}`,
    );
  }

  /**
   * Log password changes
   */
  @OnEvent(AppEvents.USER_PASSWORD_CHANGED)
  async handlePasswordChanged(payload: UserPasswordChangedEvent) {
    await this.logActivity(
      payload.userId,
      'PASSWORD_CHANGED',
      payload.sessionsInvalidated
        ? 'Password changed, other sessions invalidated'
        : 'Password changed',
    );
  }

  /**
   * Log successful payments
   */
  @OnEvent(AppEvents.PAYMENT_COMPLETED)
  async handlePaymentCompleted(payload: PaymentCompletedEvent) {
    await this.logActivity(
      payload.userId,
      'PAYMENT_COMPLETED',
      `Payment: ${payload.amount} ${payload.currency} via ${payload.provider}`,
    );
  }

  /**
   * Log failed payments
   */
  @OnEvent(AppEvents.PAYMENT_FAILED)
  async handlePaymentFailed(payload: PaymentFailedEvent) {
    await this.logActivity(
      payload.userId,
      'PAYMENT_FAILED',
      `Payment failed: ${payload.errorMessage || 'Unknown error'} (${payload.errorCode || 'no code'})`,
      'FAILED',
    );
  }

  /**
   * Log subscription creation
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CREATED)
  async handleSubscriptionCreated(payload: SubscriptionCreatedEvent) {
    await this.logActivity(
      payload.userId,
      'SUBSCRIPTION_CREATED',
      `Subscribed to ${payload.planName} via ${payload.provider}`,
    );
  }

  /**
   * Log subscription changes
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CHANGED)
  async handleSubscriptionChanged(payload: SubscriptionChangedEvent) {
    await this.logActivity(
      payload.userId,
      'SUBSCRIPTION_CHANGED',
      `Subscription ${payload.changeType}: ${payload.previousPlanName} → ${payload.newPlanName}`,
    );
  }

  /**
   * Log subscription cancellations
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CANCELLED)
  async handleSubscriptionCancelled(payload: SubscriptionCancelledEvent) {
    await this.logActivity(
      payload.userId,
      'SUBSCRIPTION_CANCELLED',
      `Subscription cancelled: ${payload.planId} (reason: ${payload.reason || 'not specified'})`,
    );
  }

  /**
   * Log AI usage (voice cloning, story generation, image generation, etc.)
   */
  @OnEvent(AppEvents.AI_USAGE_TRACKED)
  async handleAiUsageTracked(payload: AiUsageTrackedEvent) {
    await this.logActivity(
      payload.userId,
      'AI_GENERATION',
      JSON.stringify({
        provider: payload.provider,
        type: payload.type,
        credits: payload.credits,
      }),
    );
  }
}
