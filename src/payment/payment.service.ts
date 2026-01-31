import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { IapPlatform, VerifyPurchaseDto } from './dto/verify-purchase.dto';
import { IapVerifierFactory } from './strategies/iap-verifier.factory';
import { PAYMENT_CONSTANTS } from './payment.constants';

import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly iapVerifierFactory: IapVerifierFactory,
    private readonly prisma: PrismaService,
  ) { }

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
    const planDef = PAYMENT_CONSTANTS.PLANS[plan];
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
        currency: PAYMENT_CONSTANTS.CURRENCY,
        status: PAYMENT_CONSTANTS.TRANSACTION_STATUS.PENDING,
      },
    });

    // Simulate processing...
    // In a real scenario, this is where we'd call Stripe/etc.
    const updatedTx = await this.prisma.paymentTransaction.update({
      where: { id: tx.id },
      data: {
        status: PAYMENT_CONSTANTS.TRANSACTION_STATUS.SUCCESS,
        reference: `sim-${Date.now()}`,
      },
    });

    return this.upsertSubscription(userId, plan, updatedTx);
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

  /**
   * IAP Verification
   */
  async verifyPurchase(userId: string, dto: VerifyPurchaseDto) {
    try {
      const verifier = this.iapVerifierFactory.getVerifier(dto.platform);
      const isValid = await verifier.verify(dto.productId, dto.receipt);

      if (!isValid) {
        throw new BadRequestException('Invalid purchase receipt');
      }

      const plan = this.mapProductIdToPlan(dto.productId);
      const planDef = PAYMENT_CONSTANTS.PLANS[plan];

      // Record the transaction
      const tx = await this.prisma.paymentTransaction.create({
        data: {
          userId,
          paymentMethodId: null, // IAP doesn't use our internal payment methods
          amount: planDef.amount,
          currency: PAYMENT_CONSTANTS.CURRENCY,
          status: PAYMENT_CONSTANTS.TRANSACTION_STATUS.SUCCESS,
          reference: `iap-${dto.platform}-${Date.now()}`,
        },
      });

    } catch (error) {
      this.logger.error('IAP Verification Error', error);
      // Handle Prisma unique constraint error just in case race condition happened between find and create
      if (error.code === 'P2002') {
        throw new BadRequestException('Transaction already processed');
      }
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Purchase verification failed');
    }
  }

  private hashReceipt(receipt: string): string {
    // Basic hash to keep reference length reasonable and safe
    let hash = 0;
    for (let i = 0; i < receipt.length; i++) {
      const char = receipt.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private async upsertSubscription(userId: string, plan: string, transaction: any, tx: any = prisma) {
    const planDef = PAYMENT_CONSTANTS.PLANS[plan];
    const now = new Date();
    const endsAt = new Date(now.getTime() + planDef.days * PAYMENT_CONSTANTS.MILLISECONDS_PER_DAY);

    const existingSub = await this.prisma.subscription.findFirst({ where: { userId } });

    let subscription;
    if (existingSub) {
      subscription = await this.prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          plan,
          status: 'active',
          startedAt: now,
          endsAt,
        },
      });
    } else {
      subscription = await this.prisma.subscription.create({
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
      success: true,
      transaction,
      subscription: { plan, status: 'active', startedAt: now, endsAt },
    };
  }

  private mapProductIdToPlan(productId: string): string {
    // Determine plan from productId (simple mapping)
    // Assuming productId matches one of our plan keys or follows a pattern
    // For now, we trust the frontend to send the correct plan or mapped productId
    // In production, you'd map productId -> plan
    if (PAYMENT_CONSTANTS.PLANS[productId]) return productId;

    if (productId.includes('yearly')) return 'yearly';
    if (productId.includes('weekly')) return 'weekly';

    // Default fallback
    this.logger.warn(`Could not map productId ${productId} to a plan. Defaulting to monthly.`);
    return 'monthly';
  }
}
