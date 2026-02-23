import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { SubscriptionService } from '@/subscription/subscription.service';
import { VerifyPurchaseDto } from './dto/verify-purchase.dto';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { createHash } from 'crypto';
import {
  PLANS,
  PRODUCT_ID_TO_PLAN,
} from '@/subscription/subscription.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppEvents,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  SubscriptionCreatedEvent,
  SubscriptionChangedEvent,
} from '@/shared/events';

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
    private readonly configService: ConfigService,
    private readonly subscriptionService: SubscriptionService,
    private readonly googleVerificationService: GoogleVerificationService,
    private readonly appleVerificationService: AppleVerificationService,
    private readonly eventEmitter: EventEmitter2,
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
        throw new BadRequestException(
          `Unsupported platform: ${String(dto.platform)}`,
        );
      }
    } catch (error) {
      // Emit payment failed event (amount estimated from product)
      const planKey = PRODUCT_ID_TO_PLAN[dto.productId];
      const plan = planKey ? PLANS[planKey] : null;

      const failedEvent: PaymentFailedEvent = {
        userId,
        amount: plan?.amount || 0,
        currency: 'USD', // Default currency for IAP
        provider: dto.platform,
        errorCode: error.code,
        errorMessage: this.getErrorMessage(error),
        failedAt: new Date(),
      };
      this.eventEmitter.emit(AppEvents.PAYMENT_FAILED, failedEvent);

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      const errorMessage = this.getErrorMessage(error);
      this.logger.error(`Purchase verification failed: ${errorMessage}`);

      // Emit payment failed event
      this.eventEmitter.emit(AppEvents.PAYMENT_FAILED, {
        userId,
        amount: 0, // Unknown at this point
        currency: 'USD',
        provider: dto.platform,
        errorMessage,
        failedAt: new Date(),
      } satisfies PaymentFailedEvent);

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
    const receiptHash = this.hashReceipt(dto.purchaseToken);

    // Calculate subscription end date
    let endsAt: Date;
    if (result.isSubscription && result.expirationTime) {
      endsAt = result.expirationTime;
    } else {
      const now = new Date();
      endsAt = new Date(now.getTime() + planDef.days * 24 * 60 * 60 * 1000);
    }

    const googleDetails = {
      platform: 'google',
      productId: dto.productId,
      purchaseToken: dto.purchaseToken,
    };

    // Atomically process payment and subscription together
    const { tx, subscription, alreadyProcessed } =
      await this.processPaymentAndSubscriptionAtomic(
        userId,
        receiptHash,
        result.amount ?? planDef.amount,
        result.currency ?? 'USD',
        plan,
        endsAt,
        googleDetails,
      );

    return {
      success: true,
      alreadyProcessed,
      transaction: tx,
      subscription,
    };
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
    const receiptHash = this.hashReceipt(dto.purchaseToken);

    // Calculate subscription end date
    let endsAt: Date;
    if (result.isSubscription && result.expirationTime) {
      endsAt = result.expirationTime;
    } else {
      const now = new Date();
      endsAt = new Date(now.getTime() + planDef.days * 24 * 60 * 60 * 1000);
    }

    const appleDetails = {
      platform: 'apple',
      productId: dto.productId,
      purchaseToken: result.originalTxId ?? dto.purchaseToken,
    };

    // Atomically process payment and subscription together
    const { tx, subscription, alreadyProcessed } =
      await this.processPaymentAndSubscriptionAtomic(
        userId,
        receiptHash,
        result.amount ?? planDef.amount,
        result.currency ?? 'USD',
        plan,
        endsAt,
        appleDetails,
      );

    return {
      success: true,
      alreadyProcessed,
      transaction: tx,
      subscription,
    };
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

  async getSubscription(userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId },
    });

    if (!subscription) return null;

    // Fetch the latest successful payment transaction for price/currency
    const latestPayment = await this.prisma.paymentTransaction.findFirst({
      where: { userId, status: 'success' },
      orderBy: { createdAt: 'desc' },
    });

    return {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      startedAt: subscription.startedAt,
      endsAt: subscription.endsAt,
      platform: subscription.platform ?? null,
      price: latestPayment?.amount ?? 0,
      currency: latestPayment?.currency ?? 'USD',
    };
  }

  async cancelSubscription(userId: string) {
    const existing = await this.prisma.subscription.findFirst({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('No subscription to cancel');

    let platformWarning: string | undefined;
    let manageUrl: string | undefined;

    // Attempt platform-specific cancellation
    if (existing.platform === 'google' && existing.productId && existing.purchaseToken) {
      try {
        await this.googleVerificationService.cancelSubscription({
          packageName: this.configService.get<string>('GOOGLE_PLAY_PACKAGE_NAME') ?? '',
          productId: existing.productId,
          purchaseToken: existing.purchaseToken,
        });
        this.logger.log(`Google subscription cancelled for user ${userId.substring(0, 8)}`);
      } catch (error) {
        this.logger.warn(
          `Google cancellation API failed for user ${userId.substring(0, 8)}: ${this.getErrorMessage(error)}`,
        );
      }
    } else if (existing.platform === 'apple' && existing.purchaseToken) {
      try {
        const appleStatus = await this.appleVerificationService.getSubscriptionStatus(
          existing.purchaseToken,
        );
        if (appleStatus.autoRenewActive) {
          platformWarning =
            'Apple subscription auto-renewal is still active. Please manage your subscription through your Apple ID settings.';
          manageUrl = 'https://apps.apple.com/account/subscriptions';
        }
      } catch (error) {
        this.logger.warn(
          `Apple subscription status check failed for user ${userId.substring(0, 8)}: ${this.getErrorMessage(error)}`,
        );
      }
    }

    // Always perform local cancellation regardless of platform API results
    const now = new Date();
    const endsAt =
      existing.endsAt && existing.endsAt > now ? existing.endsAt : now;

    const cancelled = await this.prisma.subscription.update({
      where: { id: existing.id },
      data: { status: 'cancelled', endsAt },
    });

    // Invalidate subscription cache after cancellation
    await this.subscriptionService.invalidateCache(userId);

    return {
      ...cancelled,
      ...(platformWarning && { platformWarning }),
      ...(manageUrl && { manageUrl }),
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /**
   * Atomically process payment and subscription in a single transaction.
   * Uses DB unique constraint on `reference` for race-condition-safe duplicate detection.
   *
   * This ensures that payment records and subscription updates are never out of sync.
   */
  private async processPaymentAndSubscriptionAtomic(
    userId: string,
    reference: string,
    amount: number,
    currency: string,
    plan: string,
    endsAt: Date,
    platformDetails?: { platform: string; productId: string; purchaseToken: string },
  ): Promise<{
    tx: TransactionRecord;
    subscription: {
      plan: string;
      status: string;
      startedAt: Date;
      endsAt: Date | null;
    };
    alreadyProcessed: boolean;
  }> {
    // First check if this transaction was already processed (idempotency check)
    const existingTx = await this.prisma.paymentTransaction.findFirst({
      where: { reference },
    });

    if (existingTx) {
      // Verify the existing transaction belongs to the current user
      if (existingTx.userId !== userId) {
        throw new BadRequestException(
          'This purchase receipt has already been used by another account',
        );
      }

      // Return existing data without cache invalidation (no state change)
      const existingSub = await this.prisma.subscription.findFirst({
        where: { userId },
      });

      return {
        tx: existingTx,
        subscription: existingSub
          ? {
              plan: existingSub.plan,
              status: existingSub.status,
              startedAt: existingSub.startedAt,
              endsAt: existingSub.endsAt,
            }
          : { plan, status: 'active', startedAt: new Date(), endsAt },
        alreadyProcessed: true,
      };
    }

    // Process new payment + subscription atomically
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Create payment transaction
      const paymentTx = await tx.paymentTransaction.create({
        data: {
          userId,
          paymentMethodId: null,
          amount,
          currency,
          status: 'success',
          reference,
        },
      });

      // Upsert subscription
      const existingSub = await tx.subscription.findFirst({
        where: { userId },
      });

      let subscription;

      if (existingSub) {
        subscription = await tx.subscription.update({
          where: { id: existingSub.id },
          data: {
            plan,
            status: 'active',
            startedAt: now,
            endsAt,
            platform: platformDetails?.platform ?? null,
            productId: platformDetails?.productId ?? null,
            purchaseToken: platformDetails?.purchaseToken ?? null,
          },
        });
      } else {
        subscription = await tx.subscription.create({
          data: {
            userId,
            plan,
            status: 'active',
            startedAt: now,
            endsAt,
            platform: platformDetails?.platform ?? null,
            productId: platformDetails?.productId ?? null,
            purchaseToken: platformDetails?.purchaseToken ?? null,
          },
        });
      }

      return { paymentTx, subscription, existingSub };
    });

    // Invalidate subscription cache after successful update
    await this.subscriptionService.invalidateCache(userId);

    // Emit payment completed event
    this.eventEmitter.emit(AppEvents.PAYMENT_COMPLETED, {
      paymentId: result.paymentTx.id,
      userId,
      amount,
      currency,
      provider: reference.startsWith('google_') ? 'google' : 'apple',
      subscriptionId: result.subscription.id,
      completedAt: now,
    } satisfies PaymentCompletedEvent);

    // Emit subscription events
    if (result.existingSub) {
      // Only emit SUBSCRIPTION_CHANGED if plan actually changed
      if (result.existingSub.plan !== plan) {
        const changeType = this.determineChangeType(
          result.existingSub.plan,
          plan,
        );

        this.eventEmitter.emit(AppEvents.SUBSCRIPTION_CHANGED, {
          subscriptionId: result.subscription.id,
          userId,
          previousPlanId: result.existingSub.plan,
          newPlanId: plan,
          previousPlanName:
            PLANS[result.existingSub.plan]?.display || result.existingSub.plan,
          newPlanName: PLANS[plan]?.display || plan,
          changeType,
          changedAt: now,
        } satisfies SubscriptionChangedEvent);
      }
    } else {
      // New subscription created
      this.eventEmitter.emit(AppEvents.SUBSCRIPTION_CREATED, {
        subscriptionId: result.subscription.id,
        userId,
        planId: plan,
        planName: PLANS[plan]?.display || plan,
        provider: reference.startsWith('google_') ? 'google' : 'apple',
        createdAt: now,
      } satisfies SubscriptionCreatedEvent);
    }

    this.logger.log(
      `Payment completed: ${result.paymentTx.id} for user ${userId.substring(0, 8)}`,
    );

    return {
      tx: result.paymentTx,
      subscription: {
        plan: result.subscription.plan,
        status: result.subscription.status,
        startedAt: result.subscription.startedAt,
        endsAt: result.subscription.endsAt,
      },
      alreadyProcessed: false,
    };
  }

  /**
   * Determine the type of subscription change based on plan amounts
   */
  private determineChangeType(
    previousPlan: string,
    newPlan: string,
  ): 'upgrade' | 'downgrade' | 'renewal' {
    const previousAmount = PLANS[previousPlan]?.amount || 0;
    const newAmount = PLANS[newPlan]?.amount || 0;

    if (previousPlan === newPlan) {
      return 'renewal';
    } else if (newAmount > previousAmount) {
      return 'upgrade';
    } else {
      return 'downgrade';
    }
  }

  /**
   * Race-condition-safe transaction creation.
   * Handles Prisma P2002 unique constraint errors by fetching the existing record.
   */
  private async createTransactionAtomic(data: Prisma.PaymentTransactionCreateInput) {
    try {
      return await this.prisma.paymentTransaction.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn('Duplicate transaction detected, fetching existing');
        return this.prisma.paymentTransaction.findFirst({
          where: {
            userId: data.user?.connect?.id,
            reference: data.reference as string,
          },
        });
      }
      throw error;
    }
  }
}
