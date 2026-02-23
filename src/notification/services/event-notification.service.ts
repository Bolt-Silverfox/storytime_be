import { Injectable, Logger } from '@nestjs/common';
import { ErrorHandler } from '@/shared/utils/error-handler.util';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '../notification.service';
import {
  AppEvents,
  QuotaExhaustedEvent,
  SubscriptionCreatedEvent,
  PaymentFailedEvent,
} from '@/shared/events';

/**
 * Bridges domain events to email notifications.
 *
 * This service listens to application events and sends appropriate
 * email notifications to users. It handles user data fetching and
 * gracefully handles failures to avoid blocking event processing.
 */
@Injectable()
export class EventNotificationService {
  private readonly logger = new Logger(EventNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Send upgrade prompt email when user exhausts their quota
   */
  @OnEvent(AppEvents.QUOTA_EXHAUSTED)
  async handleQuotaExhausted(event: QuotaExhaustedEvent): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: event.userId },
        select: { email: true, name: true },
      });

      if (!user?.email) {
        this.logger.warn(
          `Cannot send quota exhausted email: user ${event.userId} has no email`,
        );
        return;
      }

      await this.notificationService.sendNotification(
        'QuotaExhausted',
        {
          email: user.email,
          userName: user.name || 'there',
          quotaType: event.quotaType,
          used: event.used,
          limit: event.limit,
        },
        event.userId,
      );

      this.logger.log(
        `Sent quota exhausted email to user ${event.userId} for ${event.quotaType}`,
      );
    } catch (error) {
      // Log but don't throw - we don't want to block event processing
      this.logger.error(
        `Failed to send quota exhausted email to user ${event.userId}`,
        ErrorHandler.extractStack(error) ?? String(error),
      );
    }
  }

  /**
   * Send welcome email when user subscribes to premium
   */
  @OnEvent(AppEvents.SUBSCRIPTION_CREATED)
  async handleSubscriptionCreated(
    event: SubscriptionCreatedEvent,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: event.userId },
        select: { email: true, name: true },
      });

      if (!user?.email) {
        this.logger.warn(
          `Cannot send subscription welcome email: user ${event.userId} has no email`,
        );
        return;
      }

      await this.notificationService.sendNotification(
        'SubscriptionWelcome',
        {
          email: user.email,
          userName: user.name || 'there',
          planName: event.planName,
        },
        event.userId,
      );

      this.logger.log(
        `Sent subscription welcome email to user ${event.userId} for ${event.planName}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send subscription welcome email to user ${event.userId}`,
        ErrorHandler.extractStack(error) ?? String(error),
      );
    }
  }

  /**
   * Send alert email when payment fails
   */
  @OnEvent(AppEvents.PAYMENT_FAILED)
  async handlePaymentFailed(event: PaymentFailedEvent): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: event.userId },
        select: { email: true, name: true },
      });

      if (!user?.email) {
        this.logger.warn(
          `Cannot send payment failed email: user ${event.userId} has no email`,
        );
        return;
      }

      await this.notificationService.sendNotification(
        'PaymentFailed',
        {
          email: user.email,
          userName: user.name || 'there',
          errorMessage: event.errorMessage,
        },
        event.userId,
      );

      this.logger.log(`Sent payment failed email to user ${event.userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send payment failed email to user ${event.userId}`,
        ErrorHandler.extractStack(error) ?? String(error),
      );
    }
  }
}
