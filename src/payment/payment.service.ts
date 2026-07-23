import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { VerifyPurchaseDto } from './dto/verify-purchase.dto';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { createHash } from 'crypto';
import {
  PLANS,
  PRODUCT_ID_TO_PLAN,
} from '@/subscription/subscription.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationService } from '../notification/notification.service';
import {
  SUBSCRIPTION_REPOSITORY,
  ISubscriptionRepository,
  PAYMENT_TRANSACTION_REPOSITORY,
  IPaymentTransactionRepository,
} from './repositories';

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
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: ISubscriptionRepository,
    @Inject(PAYMENT_TRANSACTION_REPOSITORY)
    private readonly paymentTransactionRepository: IPaymentTransactionRepository,
    private readonly configService: ConfigService,
    private readonly googleVerificationService: GoogleVerificationService,
    private readonly appleVerificationService: AppleVerificationService,
    private readonly eventEmitter: EventEmitter2,
    // NotificationModule is @Global, so no payment.module import change is needed.
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Emit a notification, swallowing any error so notification failures never
   * break the payment/subscription flow.
   */
  private async emitNotification(
    type: 'PaymentSuccess' | 'SubscriptionAlert',
    data: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    try {
      await this.notificationService.sendNotification(type, data, userId);
    } catch (error) {
      this.logger.error(
        `Failed to emit ${type} notification for user ${userId.substring(0, 8)}: ${this.getErrorMessage(error)}`,
      );
    }
  }

  /** Resolve a human-friendly plan name from a product ID, without throwing. */
  private resolvePlanDisplay(productId: string): string {
    const planKey = PRODUCT_ID_TO_PLAN[productId];
    return (planKey && PLANS[planKey]?.display) || productId;
  }

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
        error instanceof NotFoundException ||
        error instanceof ConflictException
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

    // Google issues a NEW purchase token on upgrade/downgrade/re-subscribe and
    // links it to the prior token via `linkedPurchaseToken`. If the user's
    // stored token is that linked (old) token, migrate it forward to the new
    // token so webhook events for the new token still resolve to this user.
    await this.migrateGoogleLinkedToken(
      userId,
      dto.purchaseToken,
      result.linkedPurchaseToken ?? null,
    );

    // Acknowledge the purchase to prevent auto-refund after 3 days
    const acknowledgementState = result.metadata?.acknowledgementState;
    if (acknowledgementState !== 1) {
      const configPackageName =
        this.configService.get<string>('GOOGLE_PLAY_PACKAGE_NAME') || '';
      const packageName = (dto.packageName || configPackageName).trim();

      const ackResult =
        await this.googleVerificationService.acknowledgePurchase(
          {
            packageName,
            productId: dto.productId,
            purchaseToken: dto.purchaseToken,
          },
          result.isSubscription ?? true,
        );

      if (!ackResult.success) {
        this.logger.warn(
          `Google Play acknowledgement failed for user ${userId.substring(0, 8)}: ${ackResult.error ?? 'unknown'}. Purchase is valid but must be acknowledged within 3 days.`,
        );
      } else {
        this.logger.log(
          `Google Play purchase acknowledged for user ${userId.substring(0, 8)}`,
        );
      }
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
      const existingSub =
        await this.subscriptionRepository.findFirstByUser(userId);
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

  /**
   * Migrate a user's stored Google purchase token forward to a new token when
   * the verified purchase links back to it via `linkedPurchaseToken`.
   *
   * No-op unless the user already has a Subscription whose stored token is the
   * linked (old) token and differs from the incoming new token. The subsequent
   * subscription upsert also writes the new token, so this is idempotent — it
   * exists so the migration is explicit and happens even if the stored token is
   * the linked one on a distinct Subscription row.
   *
   * Concurrency: the swap is a DB-level compare-and-swap. When it affects zero
   * rows we re-read to distinguish an idempotent repeat (row already holds
   * `newToken` — safe to continue) from a lost race where a concurrent delivery
   * installed a DIFFERENT token. In the latter case we throw so the caller's
   * subsequent upsert never overwrites (clobbers) the concurrent winner.
   */
  private async migrateGoogleLinkedToken(
    userId: string,
    newToken: string,
    linkedToken: string | null,
  ): Promise<void> {
    if (!linkedToken || linkedToken === newToken) return;

    const existing = await this.subscriptionRepository.findFirstByUser(userId);
    if (
      !existing ||
      existing.purchaseToken === newToken ||
      existing.purchaseToken !== linkedToken
    ) {
      return;
    }

    // Compare-and-swap: fold the token match into the write so a concurrent
    // replacement cannot also pass the in-memory check above and leave the row
    // mapped to the wrong token. Guarding on the still-stored `linkedToken` means
    // only the delivery that still sees the old token wins.
    const affected = await this.subscriptionRepository.updateByIdIfToken(
      existing.id,
      linkedToken,
      { purchaseToken: newToken },
    );
    if (affected === 0) {
      // `count === 0` is NOT unconditionally benign: the guard missed either
      // because we (or an idempotent retry) already installed `newToken`, OR
      // because a concurrent delivery installed a DIFFERENT token. Re-read to
      // tell these apart. Only continue when the row already holds `newToken`
      // (our write / an idempotent repeat). If some other token won the race we
      // must NOT let the caller's subsequent upsert clobber it — abort this
      // delivery so the concurrent winner is preserved.
      const current = await this.subscriptionRepository.findById(existing.id);
      if (current?.purchaseToken === newToken) {
        this.logger.log(
          `Skipped Google purchaseToken migration for user ${userId.substring(0, 8)} (already migrated to this token)`,
        );
        return;
      }
      this.logger.warn(
        `Aborting Google purchaseToken migration for user ${userId.substring(0, 8)}: ` +
          `a concurrent delivery installed a different token; preserving the winner`,
      );
      throw new ConflictException(
        'Purchase token changed concurrently; please retry',
      );
    }
    this.logger.log(
      `Migrated Google purchaseToken (linked) for user ${userId.substring(0, 8)}`,
    );
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
      const existingSub =
        await this.subscriptionRepository.findFirstByUser(userId);
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
      throw new BadRequestException('Unknown or unsupported product ID');
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
    const existingSub =
      await this.subscriptionRepository.findFirstByUser(userId);

    const data = {
      plan,
      status: 'active',
      startedAt: now,
      endsAt,
      platform: platformDetails?.platform ?? null,
      productId: platformDetails?.productId ?? null,
      purchaseToken: platformDetails?.purchaseToken ?? null,
    };

    let subscription;
    if (existingSub) {
      // Token-guarded write (defense-in-depth CAS): only mutate the row while its
      // purchaseToken is still the value we just read. If a concurrent
      // verification installed a different token between the read above and this
      // write, the guard misses (count === 0) and we must NOT overwrite the
      // concurrent winner — re-read and return the current row unchanged so a
      // later unconditional update-by-id can never clobber the winning token.
      const guardToken = existingSub.purchaseToken ?? null;
      const affected = await this.subscriptionRepository.updateByIdIfToken(
        existingSub.id,
        guardToken,
        data,
      );
      if (affected === 0) {
        this.logger.warn(
          `Skipped subscription token write for user ${userId.substring(0, 8)}: ` +
            `a concurrent verification changed the purchase token; preserving the winner`,
        );
      }
      subscription = (await this.subscriptionRepository.findById(
        existingSub.id,
      )) ?? { userId, ...data };
    } else {
      subscription = await this.subscriptionRepository.create({
        userId,
        ...data,
      });
    }

    this.eventEmitter.emit('admin.sse.activity', {
      type: 'SUBSCRIPTION',
      userId,
      timestamp: new Date().toISOString(),
    });
    this.eventEmitter.emit('admin.sse.stats', {
      trigger: existingSub ? 'subscription_renewed' : 'subscription_created',
    });

    // Payment has succeeded and the subscription is now active/renewed.
    // Best-effort in-app + push PaymentSuccess (opt-out respected downstream).
    await this.emitNotification(
      'PaymentSuccess',
      {
        amount: transaction.amount,
        currency: transaction.currency ?? 'USD',
        plan: PLANS[plan]?.display ?? plan,
      },
      userId,
    );

    return {
      success: true,
      alreadyProcessed: false,
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
    const subscription =
      await this.subscriptionRepository.findFirstByUser(userId);
    if (!subscription) return null;

    const latestTransaction =
      await this.paymentTransactionRepository.findLatestSuccessfulByUser(
        userId,
      );

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
    const existing = await this.subscriptionRepository.findFirstByUser(userId);
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

    const subscription = await this.subscriptionRepository.updateById(
      existing.id,
      { status: 'cancelled', endsAt },
    );

    // Best-effort SubscriptionAlert on the store-side (app-initiated) cancel.
    const cancelledPlan = existing.productId
      ? this.resolvePlanDisplay(existing.productId)
      : existing.plan;
    await this.emitNotification(
      'SubscriptionAlert',
      { message: `Your ${cancelledPlan} subscription was cancelled.` },
      userId,
    );

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
      const tx = await this.paymentTransactionRepository.create({
        userId,
        paymentMethodId: null,
        amount,
        currency,
        status: 'success',
        reference,
      });
      return { tx, alreadyProcessed: false };
    } catch (error) {
      // Handle unique constraint violation (P2002)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingTx =
          await this.paymentTransactionRepository.findFirstByReference(
            reference,
          );

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
