import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { SUBSCRIPTION_STATUS, PLANS } from './subscription.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents, SubscriptionCancelledEvent } from '@/shared/events';
import { CACHE_KEYS } from '@/shared/constants/cache-keys.constants';
import { CacheMetricsService } from '@/shared/services/cache-metrics.service';
import {
  SUBSCRIPTION_REPOSITORY,
  ISubscriptionRepository,
  PAYMENT_TRANSACTION_REPOSITORY,
  IPaymentTransactionRepository,
  USER_REPOSITORY,
  IUserRepository,
} from './repositories';

// Re-export PLANS for backward compatibility
export { PLANS } from './subscription.constants';

/** Cache TTL: 1 minute (balance between freshness and performance) */
const SUBSCRIPTION_CACHE_TTL_MS = 60 * 1000;

/** Key pattern for metrics grouping */
const CACHE_KEY_PATTERN = 'subscription';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: ISubscriptionRepository,
    @Inject(PAYMENT_TRANSACTION_REPOSITORY)
    private readonly paymentTransactionRepository: IPaymentTransactionRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly cacheMetrics: CacheMetricsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getPlans() {
    return PLANS;
  }

  async getSubscriptionForUser(userId: string) {
    return this.subscriptionRepository.findFirstByUser(userId);
  }

  /**
   * Subscribe to a plan.
   * For paid plans, use the PaymentService.verifyPurchase endpoint after completing IAP.
   * This method only handles free plan subscriptions directly.
   */
  async subscribe(userId: string, planKey: string) {
    const plan = PLANS[planKey];
    if (!plan) throw new BadRequestException('Invalid plan');

    // Paid plans must go through IAP verification
    if (plan.amount > 0) {
      throw new BadRequestException(
        'Paid plans require In-App Purchase. Use /payment/verify-purchase after completing purchase.',
      );
    }

    // For free plan: use transaction to ensure atomic find-and-update/create
    const now = new Date();
    const endsAt = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

    const subscription = await this.subscriptionRepository.executeTransaction(
      async (tx) => {
        const existing = await this.subscriptionRepository.findFirstByUser(
          userId,
          tx,
        );

        if (existing) {
          return this.subscriptionRepository.updateById(
            existing.id,
            {
              plan: planKey,
              status: SUBSCRIPTION_STATUS.ACTIVE,
              startedAt: now,
              endsAt,
            },
            tx,
          );
        }

        return this.subscriptionRepository.create(
          {
            userId,
            plan: planKey,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            startedAt: now,
            endsAt,
          },
          tx,
        );
      },
    );

    // Invalidate cache after subscription change
    await this.invalidateCache(userId);

    return { subscription };
  }

  async cancel(userId: string) {
    const existing = await this.subscriptionRepository.findFirstByUser(userId);
    if (!existing) throw new NotFoundException('No active subscription');

    const now = new Date();
    // keep existing.endsAt if in future, else set endsAt = now
    const endsAt =
      existing.endsAt && existing.endsAt > now ? existing.endsAt : now;

    const cancelled = await this.subscriptionRepository.updateById(
      existing.id,
      { status: SUBSCRIPTION_STATUS.CANCELLED, endsAt },
    );

    // Emit subscription cancelled event
    const cancelledEvent: SubscriptionCancelledEvent = {
      subscriptionId: cancelled.id,
      userId,
      planId: cancelled.plan,
      effectiveEndDate: endsAt,
      cancelledAt: now,
      reason: 'user_cancelled',
    };
    this.eventEmitter.emit(AppEvents.SUBSCRIPTION_CANCELLED, cancelledEvent);
    // Cache invalidation handled by SubscriptionCacheListener

    this.logger.log(
      `Subscription cancelled for user ${userId.substring(0, 8)}`,
    );

    return cancelled;
  }

  async listHistory(userId: string) {
    return this.paymentTransactionRepository.findManyByUser(userId);
  }

  /**
   * Check if a user has an active premium subscription.
   * Results are cached for 1 minute to reduce database load.
   * Uses CacheMetricsService for automatic hit/miss tracking.
   */
  async isPremiumUser(userId: string): Promise<boolean> {
    const cacheKey = CACHE_KEYS.SUBSCRIPTION_STATUS(userId);

    // Use getOrSet pattern with metrics tracking
    return this.cacheMetrics.getOrSet(
      cacheKey,
      async () => {
        // Admins and coupon-granted access are premium regardless of an
        // active paid subscription — keep these checks alongside the
        // subscription lookup so caching doesn't drop the business rules.
        const user =
          await this.userRepository.findByIdWithSubscriptionStatus(userId);
        if (!user) return false;
        if (user.role === Role.admin) return true;

        // Coupon-granted premium access
        if (user.premiumAccessUntil && user.premiumAccessUntil > new Date()) {
          return true;
        }

        const sub = user.subscription;
        if (!sub || sub.status !== SUBSCRIPTION_STATUS.ACTIVE) return false;

        return sub.endsAt === null || sub.endsAt > new Date();
      },
      SUBSCRIPTION_CACHE_TTL_MS,
      CACHE_KEY_PATTERN,
    );
  }

  /**
   * Invalidate the subscription cache for a user.
   * Should be called when subscription status changes.
   */
  async invalidateCache(userId: string): Promise<void> {
    const cacheKey = CACHE_KEYS.SUBSCRIPTION_STATUS(userId);
    await this.cacheMetrics.del(cacheKey, CACHE_KEY_PATTERN);
  }
}
