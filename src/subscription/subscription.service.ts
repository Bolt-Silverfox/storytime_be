import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PaymentService } from '../payment/payment.service';
import { SUBSCRIPTION_STATUS } from './subscription.constants';

const prisma = new PrismaClient();

/**
 * Simple plan catalog 
 */
export const PLANS: Record<string, { display: string; amount: number; days: number }> = {
  free: { display: 'Free', amount: 0, days: 365 * 100 },
  weekly: { display: 'Weekly', amount: 1.5, days: 7 },
  monthly: { display: 'Monthly', amount: 4.99, days: 30 },
  yearly: { display: 'Yearly', amount: 47.99, days: 365 },
};

@Injectable()
export class SubscriptionService {
  constructor(private readonly paymentService?: PaymentService) { }

  getPlans() {
    return PLANS;
  }

  async getSubscriptionForUser(userId: string) {
    return prisma.subscription.findFirst({ where: { userId } });
  }

  /**
   * Subscribe (if amount > 0, expect the frontend to handle payment or provide paymentMethodId)
   * If PaymentService is present and you pass charge = true, it will attempt a charge using paymentService.chargeSubscription
   */
  async subscribe(
    userId: string,
    planKey: string,
    options?: { paymentMethodId?: string; transactionPin?: string; charge?: boolean },
  ) {
    const plan = PLANS[planKey];
    if (!plan) throw new BadRequestException('Invalid plan');

    // If paid plan and charge requested, require paymentMethodId and optionally use PaymentService
    if (plan.amount > 0 && options?.charge) {
      if (!options.paymentMethodId) {
        throw new BadRequestException('paymentMethodId required for paid plan when charge=true');
      }
      if (!this.paymentService) {
        throw new BadRequestException('PaymentService not configured on server');
      }
      // Delegate to payment service; it will upsert subscription on success
      const result = await this.paymentService.chargeSubscription(userId, {
        plan: planKey,
        paymentMethodId: options.paymentMethodId,
        transactionPin: options.transactionPin,
      });
      return {
        plan: planKey,
        subscription: await this.getSubscriptionForUser(userId),
        transaction: result.transaction,
      };
    }

    // For free plan or charge=false: just create/activate subscription
    const now = new Date();
    const endsAt = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

    const existing = await prisma.subscription.findFirst({ where: { userId } });

    if (existing) {
      const updated = await prisma.subscription.update({
        where: { id: existing.id },
        data: { plan: planKey, status: SUBSCRIPTION_STATUS.ACTIVE, startedAt: now, endsAt },
      });
      return { subscription: updated };
    }

    const sub = await prisma.subscription.create({
      data: {
        userId,
        plan: planKey,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        startedAt: now,
        endsAt,
      },
    });

    return { subscription: sub };
  }

  async cancel(userId: string) {
    const existing = await prisma.subscription.findFirst({ where: { userId } });
    if (!existing) throw new NotFoundException('No active subscription');

    const now = new Date();
    // keep existing.endsAt if in future, else set endsAt = now
    const endsAt = existing.endsAt && existing.endsAt > now ? existing.endsAt : now;

    const cancelled = await prisma.subscription.update({
      where: { id: existing.id },
      data: { status: SUBSCRIPTION_STATUS.CANCELLED, endsAt },
    });

    return cancelled;
  }

  async reactivate(userId: string, planKey: string, options?: { paymentMethodId?: string; charge?: boolean; transactionPin?: string }) {
    // reuse subscribe logic to create/update
    return this.subscribe(userId, planKey, { paymentMethodId: options?.paymentMethodId, charge: options?.charge, transactionPin: options?.transactionPin });
  }

  async listHistory(userId: string) {
    return prisma.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
