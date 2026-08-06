import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SUBSCRIPTION_STATUS, PLANS } from './subscription.constants';
import { NotificationService } from '../notification/notification.service';

// Re-export PLANS for backward compatibility
export { PLANS } from './subscription.constants';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Emit a SubscriptionAlert notification, swallowing any error so that
   * notification failures never break the subscription flow.
   */
  private async emitSubscriptionAlert(
    userId: string,
    message: string,
  ): Promise<void> {
    try {
      await this.notificationService.sendNotification(
        'SubscriptionAlert',
        { message },
        userId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit SubscriptionAlert for user ${userId.substring(0, 8)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async isPremiumUser(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        premiumAccessUntil: true,
        subscription: { select: { status: true, endsAt: true } },
      },
    });
    if (!user) return false;
    if (user.role === Role.admin) return true;

    // Check coupon-granted premium access
    if (user.premiumAccessUntil && user.premiumAccessUntil > new Date()) {
      return true;
    }

    const sub = user.subscription;
    if (!sub || sub.status !== SUBSCRIPTION_STATUS.ACTIVE) return false;

    return sub.endsAt === null || sub.endsAt > new Date();
  }

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

    // For free plan: just create/activate subscription
    const now = new Date();
    const endsAt = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

    const existing = await this.prisma.subscription.findFirst({
      where: { userId },
    });

    const activatedMessage = `Your ${plan.display} subscription is now active.`;

    if (existing) {
      const updated = await this.prisma.subscription.update({
        where: { id: existing.id },
        data: {
          plan: planKey,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          startedAt: now,
          endsAt,
        },
      });
      await this.emitSubscriptionAlert(userId, activatedMessage);
      return { subscription: updated };
    }

    const sub = await this.prisma.subscription.create({
      data: {
        userId,
        plan: planKey,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        startedAt: now,
        endsAt,
      },
    });

    await this.emitSubscriptionAlert(userId, activatedMessage);

    return { subscription: sub };
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

    const planDisplay = PLANS[existing.plan]?.display ?? existing.plan;
    await this.emitSubscriptionAlert(
      userId,
      `Your ${planDisplay} subscription was cancelled.`,
    );

    return cancelled;
  }

  async listHistory(userId: string) {
    return this.prisma.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
