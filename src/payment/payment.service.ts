import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { VerifyPurchaseDto } from './dto/verify-purchase.dto';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { createHash } from 'crypto';
import {
  PLANS,
  PRODUCT_ID_TO_PLAN,
} from '@/subscription/subscription.constants';

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
        throw new BadRequestException(
          `Unsupported platform: ${String(dto.platform)}`,
        );
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
    const receiptHash = this.hashReceipt(dto.purchaseToken);

    // Atomic create-or-get: try to create, handle unique constraint violation
    const { tx, alreadyProcessed } = await this.createTransactionAtomic(
      userId,
      receiptHash,
      result.amount ?? planDef.amount,
      result.currency ?? 'USD',
    );

    if (alreadyProcessed) {
      const existingSub = await this.prisma.subscription.findFirst({
        where: { userId },
      });
      return {
        success: true,
        alreadyProcessed: true,
        transaction: tx,
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

    const googleDetails = {
      platform: 'google',
      productId: dto.productId,
      purchaseToken: dto.purchaseToken,
    };

    // For subscriptions, use the expiration time from Google
    if (result.isSubscription && result.expirationTime) {
      return this.upsertSubscriptionWithExpiry(
        userId,
        plan,
        tx,
        result.expirationTime,
        googleDetails,
      );
    }

    return this.upsertSubscription(userId, plan, tx, googleDetails);
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

    // Atomic create-or-get: try to create, handle unique constraint violation
    const { tx, alreadyProcessed } = await this.createTransactionAtomic(
      userId,
      receiptHash,
      result.amount ?? planDef.amount,
      result.currency ?? 'USD',
    );

    if (alreadyProcessed) {
      const existingSub = await this.prisma.subscription.findFirst({
        where: { userId },
      });
      return {
        success: true,
        alreadyProcessed: true,
        transaction: tx,
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

    const appleDetails = {
      platform: 'apple',
      productId: dto.productId,
      // Store originalTransactionId for subscription status lookups
      purchaseToken: result.originalTxId ?? dto.purchaseToken,
    };

    if (result.isSubscription && result.expirationTime) {
      return this.upsertSubscriptionWithExpiry(
        userId,
        plan,
        tx,
        result.expirationTime,
        appleDetails,
      );
    }

    return this.upsertSubscription(userId, plan, tx, appleDetails);
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
    platformDetails?: {
      platform: string;
      productId: string;
      purchaseToken: string;
    },
  ) {
    const planDef = PLANS[plan];
    const now = new Date();
    const endsAt = new Date(now.getTime() + planDef.days * 24 * 60 * 60 * 1000);

    return this.upsertSubscriptionWithExpiry(
      userId,
      plan,
      transaction,
      endsAt,
      platformDetails,
    );
  }

  private async upsertSubscriptionWithExpiry(
    userId: string,
    plan: string,
    transaction: TransactionRecord,
    endsAt: Date,
    platformDetails?: {
      platform: string;
      productId: string;
      purchaseToken: string;
    },
  ) {
    const now = new Date();
    const existingSub = await this.prisma.subscription.findFirst({
      where: { userId },
    });

    const data = {
      plan,
      status: 'active',
      startedAt: now,
      endsAt,
      platform: platformDetails?.platform ?? null,
      productId: platformDetails?.productId ?? null,
      purchaseToken: platformDetails?.purchaseToken ?? null,
    };

    const subscription = existingSub
      ? await this.prisma.subscription.update({
          where: { id: existingSub.id },
          data,
        })
      : await this.prisma.subscription.create({
          data: {
            userId,
            ...data,
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
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId },
    });
    if (!subscription) return null;

    const latestTransaction = await this.prisma.paymentTransaction.findFirst({
      where: { userId, status: 'success' },
      orderBy: { createdAt: 'desc' },
    });

    const planDef = PLANS[subscription.plan];
    const price = latestTransaction?.amount ?? planDef?.amount ?? 0;
    const currency = latestTransaction?.currency ?? 'USD';

    return {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      startedAt: subscription.startedAt,
      endsAt: subscription.endsAt,
      platform: subscription.platform ?? null,
      price,
      currency,
    };
  }

  async cancelSubscription(userId: string) {
    const existing = await this.prisma.subscription.findFirst({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('No subscription to cancel');

    // Cancel on Google Play if this is a Google subscription with stored tokens
    if (
      existing.platform === 'google' &&
      existing.productId &&
      existing.purchaseToken
    ) {
      const packageName =
        this.configService.get<string>('GOOGLE_PLAY_PACKAGE_NAME') || '';

      if (packageName) {
        try {
          const cancelResult =
            await this.googleVerificationService.cancelSubscription({
              packageName,
              productId: existing.productId,
              purchaseToken: existing.purchaseToken,
            });

          if (!cancelResult.success) {
            this.logger.warn(
              `Google Play cancellation failed for user ${userId.substring(0, 8)}: ${cancelResult.error ?? 'unknown error'}. Proceeding with local cancel.`,
            );
          } else {
            this.logger.log(
              `Google Play subscription cancelled for user ${userId.substring(0, 8)}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Google Play cancellation threw for user ${userId.substring(0, 8)}: ${error instanceof Error ? error.message : String(error)}. Proceeding with local cancel.`,
          );
        }
      } else {
        this.logger.warn(
          'GOOGLE_PLAY_PACKAGE_NAME not configured, skipping Play Store cancellation',
        );
      }
    }

    // Check Apple subscription auto-renewal status
    let appleAutoRenewWarning: string | undefined;
    if (existing.platform === 'apple' && existing.purchaseToken) {
      const statusResult =
        await this.appleVerificationService.getSubscriptionStatus(
          existing.purchaseToken,
        );

      if (statusResult.error) {
        this.logger.warn(
          `Apple subscription status check failed for user ${userId.substring(0, 8)}: ${statusResult.error}`,
        );
      } else if (statusResult.autoRenewActive) {
        appleAutoRenewWarning =
          'Auto-renewal is still active on Apple. To stop being charged, cancel your subscription in Settings > Subscriptions on your Apple device.';
        this.logger.warn(
          `Apple auto-renewal still active for user ${userId.substring(0, 8)}`,
        );
      } else {
        this.logger.log(
          `Apple auto-renewal already off for user ${userId.substring(0, 8)}`,
        );
      }
    }

    const now = new Date();
    const endsAt =
      existing.endsAt && existing.endsAt > now ? existing.endsAt : now;

    const subscription = await this.prisma.subscription.update({
      where: { id: existing.id },
      data: { status: 'cancelled', endsAt },
    });

    if (appleAutoRenewWarning) {
      return {
        ...subscription,
        warning: appleAutoRenewWarning,
        manageUrl: 'https://apps.apple.com/account/subscriptions',
      };
    }

    return subscription;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /**
   * Atomically create a transaction or detect if one already exists.
   * Uses the DB unique constraint on `reference` for race-condition-safe duplicate detection.
   */
  private async createTransactionAtomic(
    userId: string,
    reference: string,
    amount: number,
    currency: string,
  ): Promise<{ tx: TransactionRecord; alreadyProcessed: boolean }> {
    try {
      const tx = await this.prisma.paymentTransaction.create({
        data: {
          userId,
          paymentMethodId: null,
          amount,
          currency,
          status: 'success',
          reference,
        },
      });
      return { tx, alreadyProcessed: false };
    } catch (error) {
      // Handle unique constraint violation (P2002)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingTx = await this.prisma.paymentTransaction.findFirst({
          where: { reference },
        });

        if (!existingTx) {
          // Should not happen, but handle gracefully
          throw new BadRequestException(
            'Transaction conflict detected. Please retry.',
          );
        }

        // Verify the existing transaction belongs to the current user
        if (existingTx.userId !== userId) {
          throw new BadRequestException(
            'This purchase receipt has already been used by another account',
          );
        }

        return { tx: existingTx, alreadyProcessed: true };
      }
      throw error;
    }
  }
}
