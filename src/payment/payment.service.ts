import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

/**
 * Plan definitions: amount and duration in days
 */
const PLANS: Record<string, { amount: number; days: number }> = {
  free: { amount: 0, days: 365 * 100 }, // effectively permanent free
  weekly: { amount: 1.5, days: 7 },
  monthly: { amount: 4.99, days: 30 },
  yearly: { amount: 47.99, days: 365 },
};

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Add a payment method for a user (simple store)
   */
  async addPaymentMethod(userId: string, payload: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const pm = await this.prisma.paymentMethod.create({
      data: {
        userId,
        type: payload.type,
        details: payload.details,
        provider: payload.provider ?? null,
        last4: payload.last4 ?? null,
        expiry: payload.expiry ?? null,
        meta: payload.meta ?? null,
      },
    });

    return pm;
  }


  async listPaymentMethods(userId: string) {
    return this.prisma.paymentMethod.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async removePaymentMethod(userId: string, id: string) {
    const existing = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Payment method not found');
    return this.prisma.paymentMethod.delete({ where: { id } });
  }

  /**
   * Simulated charge flow:
   * - validate plan
   * - optionally validate transactionPin
   * - create a PaymentTransaction record with status
   * - if success: upsert subscription (starts now, endsAt based on plan.days)
   */
  async chargeSubscription(userId: string, body: { plan: string; paymentMethodId?: string; transactionPin?: string }) {
    const { plan, paymentMethodId, transactionPin } = body;
    const planDef = PLANS[plan];
    if (!planDef) throw new BadRequestException('Invalid plan');

    // validate user
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // if transactionPin provided, verify against user's pinHash
    if (transactionPin) {
      if (!user.pinHash) throw new BadRequestException('No PIN set for user');
      const ok = await bcrypt.compare(transactionPin, user.pinHash);
      if (!ok) throw new BadRequestException('Invalid transaction PIN');
    }

    // basic payment method validation if non-free
    if (planDef.amount > 0) {
      if (!paymentMethodId) throw new BadRequestException('Payment method required for paid plans');
      const pm = await this.prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
      if (!pm || pm.userId !== userId) throw new NotFoundException('Payment method not found');
    }

    // create transaction (simulate pending -> success)
    const tx = await this.prisma.paymentTransaction.create({
      data: {
        userId,
        paymentMethodId: paymentMethodId ?? null,
        amount: planDef.amount,
        currency: 'USD',
        status: 'pending',
      },
    });

    // Simulate processing...
    const updatedTx = await this.prisma.paymentTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'success',
        reference: `sim-${Date.now()}`,
      },
    });

    // Upsert subscription: start now, endsAt = now + planDef.days
    const now = new Date();
    const endsAt = new Date(now.getTime() + planDef.days * 24 * 60 * 60 * 1000);

    const existingSub = await this.prisma.subscription.findFirst({ where: { userId } });
    if (existingSub) {
      await this.prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          plan,
          status: 'active',
          startedAt: now,
          endsAt,
        },
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          userId,
          plan,
          status: 'active',
          startedAt: now,
          endsAt,
        },
      });
    }

    return {
      transaction: updatedTx,
      subscription: { plan, status: 'active', startedAt: now, endsAt },
    };
  }

  async getSubscription(userId: string) {
    return this.prisma.subscription.findFirst({ where: { userId } });
  }

  async cancelSubscription(userId: string) {
    const existing = await this.prisma.subscription.findFirst({ where: { userId } });
    if (!existing) throw new NotFoundException('No subscription to cancel');

    // Allow current period to run out
    const now = new Date();
    const endsAt = existing.endsAt && existing.endsAt > now ? existing.endsAt : now;

    const cancelled = await this.prisma.subscription.update({
      where: { id: existing.id },
      data: { status: 'cancelled', endsAt },
    });

    return cancelled;
  }

  async resubscribe(userId: string, paymentMethodId: string, plan: string, transactionPin?: string) {
    return this.chargeSubscription(userId, { plan, paymentMethodId, transactionPin });
  }
}
