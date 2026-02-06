import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { VerifyPurchaseDto } from './dto/verify-purchase.dto';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { createHash } from 'crypto';
import { PLANS, PRODUCT_ID_TO_PLAN } from '@/subscription/subscription.constants';

/** Transaction result from payment processing */
export interface TransactionRecord {
  id: string;
  userId: string;
  amount: number;
  currency: string | null;
  status: string;
  reference: string | null;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleVerificationService: GoogleVerificationService,
    private readonly appleVerificationService: AppleVerificationService,
  ) {}

  /**
   * Verify an In-App Purchase from Google Play or App Store
   */
  async verifyPurchase(userId: string, dto: VerifyPurchaseDto) {
    this.logger.log(
      `Verifying ${dto.platform} purchase for user ${userId.substring(0, 8)}`,
    );

    try {
      if (dto.platform === 'google') {
        return await this.verifyGooglePurchase(userId, dto);
      } else if (dto.platform === 'apple') {
        return await this.verifyApplePurchase(userId, dto);
      } else {
        throw new BadRequestException(`Unsupported platform: ${dto.platform}`);
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        `Purchase verification failed: ${this.getErrorMessage(error)}`,
      );
      throw new BadRequestException('Purchase verification failed');
    }
  }

  private async verifyGooglePurchase(userId: string, dto: VerifyPurchaseDto) {
    const result = await this.googleVerificationService.verify({
      purchaseToken: dto.purchaseToken,
      productId: dto.productId,
      packageName: dto.packageName,
    });

    if (!result.success) {
      throw new BadRequestException('Google Play purchase verification failed');
    }

    const plan = this.mapProductIdToPlan(dto.productId);
    const planDef = PLANS[plan];

    // Check for duplicate receipt
    const receiptHash = this.hashReceipt(dto.purchaseToken);
    const existingTx = await this.prisma.paymentTransaction.findFirst({
      where: { reference: receiptHash },
    });

    if (existingTx) {
      // Verify the existing transaction belongs to the current user
      if (existingTx.userId !== userId) {
        throw new BadRequestException(
          'This purchase receipt has already been used by another account',
        );
      }
      // Idempotent: return existing transaction and subscription
      const existingSub = await this.prisma.subscription.findFirst({
        where: { userId },
      });
      return {
        success: true,
        alreadyProcessed: true,
        transaction: existingTx,
        subscription: existingSub
          ? {
              plan: existingSub.plan,
              status: existingSub.status,
              startedAt: existingSub.startedAt,
              endsAt: existingSub.endsAt,
            }
          : null,
      };
    }

    // Record the transaction
    const tx = await this.prisma.paymentTransaction.create({
      data: {
        userId,
        paymentMethodId: null,
        amount: result.amount ?? planDef.amount,
        currency: result.currency ?? 'USD',
        status: 'success',
        reference: receiptHash,
      },
    });

    // For subscriptions, use the expiration time from Google
    if (result.isSubscription && result.expirationTime) {
      return this.upsertSubscriptionWithExpiry(
        userId,
        plan,
        tx,
        result.expirationTime,
      );
    }

    return this.upsertSubscription(userId, plan, tx);
  }

  private async verifyApplePurchase(userId: string, dto: VerifyPurchaseDto) {
    const result = await this.appleVerificationService.verify({
      transactionId: dto.purchaseToken,
      productId: dto.productId,
    });

    if (!result.success) {
      throw new BadRequestException(
        'Apple App Store purchase verification failed',
      );
    }

    const plan = this.mapProductIdToPlan(dto.productId);
    const planDef = PLANS[plan];

    // Check for duplicate using purchaseToken (unique per transaction)
    // Note: originalTxId is constant across renewals, so we use purchaseToken for dedupe
    const receiptHash = this.hashReceipt(dto.purchaseToken);
    const existingTx = await this.prisma.paymentTransaction.findFirst({
      where: { reference: receiptHash },
    });

    if (existingTx) {
      // Verify the existing transaction belongs to the current user
      if (existingTx.userId !== userId) {
        throw new BadRequestException(
          'This purchase receipt has already been used by another account',
        );
      }
      const existingSub = await this.prisma.subscription.findFirst({
        where: { userId },
      });
      return {
        success: true,
        alreadyProcessed: true,
        transaction: existingTx,
        subscription: existingSub
          ? {
              plan: existingSub.plan,
              status: existingSub.status,
              startedAt: existingSub.startedAt,
              endsAt: existingSub.endsAt,
            }
          : null,
      };
    }

    const tx = await this.prisma.paymentTransaction.create({
      data: {
        userId,
        paymentMethodId: null,
        amount: result.amount ?? planDef.amount,
        currency: result.currency ?? 'USD',
        status: 'success',
        reference: receiptHash,
      },
    });

    if (result.isSubscription && result.expirationTime) {
      return this.upsertSubscriptionWithExpiry(
        userId,
        plan,
        tx,
        result.expirationTime,
      );
    }

    return this.upsertSubscription(userId, plan, tx);
  }

  private mapProductIdToPlan(productId: string): string {
    const plan = PRODUCT_ID_TO_PLAN[productId];
    if (!plan) {
      this.logger.error(`Unknown product ID: ${productId}`);
      throw new BadRequestException(
        `Unknown product ID: ${productId}. Valid IDs: ${Object.keys(PRODUCT_ID_TO_PLAN).join(', ')}`,
      );
    }
    return plan;
  }

  private hashReceipt(receipt: string): string {
    return createHash('sha256').update(receipt).digest('hex').substring(0, 32);
  }

  private async upsertSubscription(
    userId: string,
    plan: string,
    transaction: TransactionRecord,
  ) {
    const planDef = PLANS[plan];
    const now = new Date();
    const endsAt = new Date(now.getTime() + planDef.days * 24 * 60 * 60 * 1000);

    return this.upsertSubscriptionWithExpiry(userId, plan, transaction, endsAt);
  }

  private async upsertSubscriptionWithExpiry(
    userId: string,
    plan: string,
    transaction: TransactionRecord,
    endsAt: Date,
  ) {
    const now = new Date();
    const existingSub = await this.prisma.subscription.findFirst({
      where: { userId },
    });

    const subscription = existingSub
      ? await this.prisma.subscription.update({
          where: { id: existingSub.id },
          data: {
            plan,
            status: 'active',
            startedAt: now,
            endsAt,
          },
        })
      : await this.prisma.subscription.create({
          data: {
            userId,
            plan,
            status: 'active',
            startedAt: now,
            endsAt,
          },
        });

    return {
      success: true,
      transaction,
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        startedAt: subscription.startedAt,
        endsAt: subscription.endsAt,
      },
    };
  }

  async getSubscription(userId: string) {
    return this.prisma.subscription.findFirst({ where: { userId } });
  }

  async cancelSubscription(userId: string) {
    const existing = await this.prisma.subscription.findFirst({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('No subscription to cancel');

    const now = new Date();
    const endsAt =
      existing.endsAt && existing.endsAt > now ? existing.endsAt : now;

    return this.prisma.subscription.update({
      where: { id: existing.id },
      data: { status: 'cancelled', endsAt },
    });
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}
