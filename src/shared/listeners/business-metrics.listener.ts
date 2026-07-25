import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { metrics, Counter } from '@opentelemetry/api';
import {
  AppEvents,
  UserRegisteredEvent,
  UserDeletedEvent,
  UserEmailVerifiedEvent,
  KidCreatedEvent,
  KidDeletedEvent,
  StoryCreatedEvent,
  StoryCompletedEvent,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  SubscriptionCreatedEvent,
  SubscriptionChangedEvent,
  SubscriptionCancelledEvent,
  BadgeEarnedEvent,
  StreakUpdatedEvent,
} from '@/shared/events';

/**
 * BusinessMetricsListener
 *
 * Bridges domain lifecycle events (users, kids, stories, payments,
 * subscriptions, achievements) into the OTLP pipeline as counters so business
 * KPIs — signups, activations, revenue, churn, engagement — show up in Grafana
 * alongside the infra/runtime metrics.
 *
 * Counters are created lazily in the constructor (which Nest runs during DI,
 * after otel-setup has registered the global MeterProvider at the top of
 * main.ts). Every handler is best-effort: an OTel add() must never break the
 * business flow that emitted the event, so all work is wrapped in try/catch.
 *
 * Labels are deliberately LOW cardinality (provider, currency, result, plan
 * change type, ai_generated) — never userId/email/storyId — so the metric
 * series stay bounded.
 */
@Injectable()
export class BusinessMetricsListener {
  private readonly logger = new Logger(BusinessMetricsListener.name);

  private readonly usersRegistered: Counter;
  private readonly usersDeleted: Counter;
  private readonly emailVerified: Counter;
  private readonly kidsCreated: Counter;
  private readonly kidsDeleted: Counter;
  private readonly storiesCreated: Counter;
  private readonly storiesCompleted: Counter;
  private readonly payments: Counter;
  private readonly paymentRevenue: Counter;
  private readonly subscriptionsCreated: Counter;
  private readonly subscriptionsChanged: Counter;
  private readonly subscriptionsCancelled: Counter;
  private readonly badgesEarned: Counter;
  private readonly streakUpdates: Counter;

  constructor() {
    const meter = metrics.getMeter('storytime-api');

    this.usersRegistered = meter.createCounter('business_users_registered_total', {
      description: 'New user registrations',
    });
    this.usersDeleted = meter.createCounter('business_users_deleted_total', {
      description: 'User account deletions',
    });
    this.emailVerified = meter.createCounter('business_email_verified_total', {
      description: 'Email verifications completed',
    });
    this.kidsCreated = meter.createCounter('business_kids_created_total', {
      description: 'Kid profiles created',
    });
    this.kidsDeleted = meter.createCounter('business_kids_deleted_total', {
      description: 'Kid profiles deleted',
    });
    this.storiesCreated = meter.createCounter('business_stories_created_total', {
      description: 'Stories created (labelled by ai_generated)',
    });
    this.storiesCompleted = meter.createCounter(
      'business_stories_completed_total',
      { description: 'Stories completed (engagement)' },
    );
    this.payments = meter.createCounter('business_payments_total', {
      description: 'Payment attempts (labelled by result + provider)',
    });
    this.paymentRevenue = meter.createCounter('business_payment_revenue_total', {
      description:
        'Sum of successful payment amounts (labelled by currency + provider)',
    });
    this.subscriptionsCreated = meter.createCounter(
      'business_subscriptions_created_total',
      { description: 'New subscriptions (labelled by provider)' },
    );
    this.subscriptionsChanged = meter.createCounter(
      'business_subscriptions_changed_total',
      { description: 'Subscription plan changes (labelled by change_type)' },
    );
    this.subscriptionsCancelled = meter.createCounter(
      'business_subscriptions_cancelled_total',
      { description: 'Subscription cancellations (churn)' },
    );
    this.badgesEarned = meter.createCounter('business_badges_earned_total', {
      description: 'Achievement badges earned',
    });
    this.streakUpdates = meter.createCounter('business_streak_updates_total', {
      description: 'Reading-streak updates',
    });
  }

  /** Wrap every add() so a metrics failure never disrupts the emitting flow. */
  private safe(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.warn(
        `Business metric emit failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  @OnEvent(AppEvents.USER_REGISTERED)
  onUserRegistered(payload: UserRegisteredEvent): void {
    this.safe(() =>
      this.usersRegistered.add(1, { role: payload.role ?? 'unknown' }),
    );
  }

  @OnEvent(AppEvents.USER_DELETED)
  onUserDeleted(_payload: UserDeletedEvent): void {
    this.safe(() => this.usersDeleted.add(1));
  }

  @OnEvent(AppEvents.USER_EMAIL_VERIFIED)
  onEmailVerified(_payload: UserEmailVerifiedEvent): void {
    this.safe(() => this.emailVerified.add(1));
  }

  @OnEvent(AppEvents.KID_CREATED)
  onKidCreated(_payload: KidCreatedEvent): void {
    this.safe(() => this.kidsCreated.add(1));
  }

  @OnEvent(AppEvents.KID_DELETED)
  onKidDeleted(_payload: KidDeletedEvent): void {
    this.safe(() => this.kidsDeleted.add(1));
  }

  @OnEvent(AppEvents.STORY_CREATED)
  onStoryCreated(payload: StoryCreatedEvent): void {
    this.safe(() =>
      this.storiesCreated.add(1, {
        ai_generated: String(payload.aiGenerated),
      }),
    );
  }

  @OnEvent(AppEvents.STORY_COMPLETED)
  onStoryCompleted(_payload: StoryCompletedEvent): void {
    this.safe(() => this.storiesCompleted.add(1));
  }

  @OnEvent(AppEvents.PAYMENT_COMPLETED)
  onPaymentCompleted(payload: PaymentCompletedEvent): void {
    this.safe(() => {
      this.payments.add(1, {
        result: 'completed',
        provider: payload.provider ?? 'unknown',
      });
      if (typeof payload.amount === 'number' && Number.isFinite(payload.amount)) {
        this.paymentRevenue.add(payload.amount, {
          currency: payload.currency ?? 'unknown',
          provider: payload.provider ?? 'unknown',
        });
      }
    });
  }

  @OnEvent(AppEvents.PAYMENT_FAILED)
  onPaymentFailed(payload: PaymentFailedEvent): void {
    this.safe(() =>
      this.payments.add(1, {
        result: 'failed',
        provider: payload.provider ?? 'unknown',
      }),
    );
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CREATED)
  onSubscriptionCreated(payload: SubscriptionCreatedEvent): void {
    this.safe(() =>
      this.subscriptionsCreated.add(1, {
        provider: payload.provider ?? 'unknown',
      }),
    );
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CHANGED)
  onSubscriptionChanged(payload: SubscriptionChangedEvent): void {
    this.safe(() =>
      this.subscriptionsChanged.add(1, {
        change_type: payload.changeType ?? 'unknown',
      }),
    );
  }

  @OnEvent(AppEvents.SUBSCRIPTION_CANCELLED)
  onSubscriptionCancelled(_payload: SubscriptionCancelledEvent): void {
    this.safe(() => this.subscriptionsCancelled.add(1));
  }

  @OnEvent(AppEvents.BADGE_EARNED)
  onBadgeEarned(_payload: BadgeEarnedEvent): void {
    this.safe(() => this.badgesEarned.add(1));
  }

  @OnEvent(AppEvents.STREAK_UPDATED)
  onStreakUpdated(_payload: StreakUpdatedEvent): void {
    this.safe(() => this.streakUpdates.add(1));
  }
}
