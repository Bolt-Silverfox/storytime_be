import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SUBSCRIPTION_STATUS, PLANS } from './subscription.constants';

// Re-export PLANS for backward compatibility
export { PLANS } from './subscription.constants';

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

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

    return cancelled;
  }

  async listHistory(userId: string) {
    return this.prisma.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
