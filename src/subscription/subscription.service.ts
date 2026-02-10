import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '@/prisma/prisma.service';
import { SUBSCRIPTION_STATUS, PLANS } from './subscription.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppEvents,
  SubscriptionCreatedEvent,
  SubscriptionChangedEvent,
  SubscriptionCancelledEvent,
} from '@/shared/events';
import { CACHE_KEYS } from '@/shared/constants/cache-keys.constants';

// Re-export PLANS for backward compatibility
export { PLANS } from './subscription.constants';

/** Cache TTL: 1 minute (balance between freshness and performance) */
const SUBSCRIPTION_CACHE_TTL_MS = 60 * 1000;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getPlans() {
    return PLANS;
  }

  async getSubscriptionForUser(userId: string) {
    return this.prisma.subscription.findFirst({ where: { userId } });
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

    const subscription = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findFirst({
        where: { userId },
      });

      if (existing) {
        return tx.subscription.update({
          where: { id: existing.id },
          data: {
            plan: planKey,
            status: SUBSCRIPTION_STATUS.ACTIVE,
            startedAt: now,
            endsAt,
          },
        });
      }

      return tx.subscription.create({
        data: {
          userId,
          plan: planKey,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          startedAt: now,
          endsAt,
        },
      });
    });

    // Invalidate cache after subscription change
    await this.invalidateCache(userId);

    return { subscription };
  }

  async cancel(userId: string) {
    const existing = await this.prisma.subscription.findFirst({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('No active subscription');

    const now = new Date();
    // keep existing.endsAt if in future, else set endsAt = now
    const endsAt =
      existing.endsAt && existing.endsAt > now ? existing.endsAt : now;

    const cancelled = await this.prisma.subscription.update({
      where: { id: existing.id },
      data: { status: SUBSCRIPTION_STATUS.CANCELLED, endsAt },
    });

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

    // Invalidate cache after subscription cancellation
    await this.invalidateCache(userId);

    this.logger.log(`Subscription cancelled for user ${userId.substring(0, 8)}`);

    return cancelled;
  }

  async listHistory(userId: string) {
    return this.prisma.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Check if a user has an active premium subscription.
   * Results are cached for 1 minute to reduce database load.
   */
  async isPremiumUser(userId: string): Promise<boolean> {
    const cacheKey = CACHE_KEYS.SUBSCRIPTION_STATUS(userId);

    // Try to get from cache first
    const cached = await this.cacheManager.get<boolean>(cacheKey);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    // Query database
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        OR: [{ endsAt: { gt: new Date() } }, { endsAt: null }],
      },
      select: { id: true }, // Only need to know if it exists
    });

    const isPremium = !!subscription;

    // Cache the result
    try {
      await this.cacheManager.set(
        cacheKey,
        isPremium,
        SUBSCRIPTION_CACHE_TTL_MS,
      );
    } catch {
      this.logger.warn(`Failed to cache subscription status for ${userId}`);
    }

    return isPremium;
  }

  /**
   * Invalidate the subscription cache for a user.
   * Should be called when subscription status changes.
   */
  async invalidateCache(userId: string): Promise<void> {
    const cacheKey = CACHE_KEYS.SUBSCRIPTION_STATUS(userId);
    try {
      await this.cacheManager.del(cacheKey);
    } catch {
      this.logger.warn(`Failed to invalidate subscription cache for ${userId}`);
    }
  }
}
