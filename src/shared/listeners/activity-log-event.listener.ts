import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import {
  AppEvents,
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
   * Log user registration
   */
  @OnEvent(AppEvents.USER_REGISTERED)
  async handleUserRegistered(payload: UserRegisteredEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'USER_REGISTERED',
          status: 'SUCCESS',
          details: `User registered: ${payload.email}`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log user registration: ${error.message}`,
      );
    }
  }

  /**
   * Log user deletion
   */
  @OnEvent(AppEvents.USER_DELETED)
  async handleUserDeleted(payload: UserDeletedEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'USER_DELETED',
          status: 'SUCCESS',
          details: `User deleted: ${payload.email} (reason: ${payload.reason || 'not specified'})`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log user deletion: ${error.message}`,
      );
    }
  }

  /**
   * Log email verification
   */
  @OnEvent(AppEvents.USER_EMAIL_VERIFIED)
  async handleEmailVerified(payload: UserEmailVerifiedEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'EMAIL_VERIFIED',
          status: 'SUCCESS',
          details: `Email verified: ${payload.email}`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log email verification: ${error.message}`,
      );
    }
  }

  /**
   * Log password changes
   */
  @OnEvent(AppEvents.USER_PASSWORD_CHANGED)
  async handlePasswordChanged(payload: UserPasswordChangedEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'PASSWORD_CHANGED',
          status: 'SUCCESS',
          details: payload.sessionsInvalidated
            ? 'Password changed, other sessions invalidated'
            : 'Password changed',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log password change: ${error.message}`,
      );
    }
  }

  /**
   * Log successful payments
   */
  @OnEvent(AppEvents.PAYMENT_COMPLETED)
  async handlePaymentCompleted(payload: PaymentCompletedEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'PAYMENT_COMPLETED',
          status: 'SUCCESS',
          details: `Payment: ${payload.amount} ${payload.currency} via ${payload.provider}`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log payment completion: ${error.message}`,
      );
    }
  }

  /**
   * Log failed payments
   */
  @OnEvent(AppEvents.PAYMENT_FAILED)
  async handlePaymentFailed(payload: PaymentFailedEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'PAYMENT_FAILED',
          status: 'FAILED',
          details: `Payment failed: ${payload.errorMessage || 'Unknown error'} (${payload.errorCode || 'no code'})`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log payment failure: ${error.message}`,
      );
    }
  }

  /**
   * Log subscription creation
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CREATED)
  async handleSubscriptionCreated(payload: SubscriptionCreatedEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'SUBSCRIPTION_CREATED',
          status: 'SUCCESS',
          details: `Subscribed to ${payload.planName} via ${payload.provider}`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log subscription creation: ${error.message}`,
      );
    }
  }

  /**
   * Log subscription changes
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CHANGED)
  async handleSubscriptionChanged(payload: SubscriptionChangedEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'SUBSCRIPTION_CHANGED',
          status: 'SUCCESS',
          details: `Subscription ${payload.changeType}: ${payload.previousPlanName} → ${payload.newPlanName}`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log subscription change: ${error.message}`,
      );
    }
  }

  /**
   * Log subscription cancellations
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CANCELLED)
  async handleSubscriptionCancelled(payload: SubscriptionCancelledEvent) {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId: payload.userId,
          action: 'SUBSCRIPTION_CANCELLED',
          status: 'SUCCESS',
          details: `Subscription cancelled: ${payload.planId} (reason: ${payload.reason || 'not specified'})`,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to log subscription cancellation: ${error.message}`,
      );
    }
  }
}
