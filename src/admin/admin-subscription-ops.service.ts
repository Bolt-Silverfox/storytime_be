import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { VerifyPurchaseDto } from '../payment/dto/verify-purchase.dto';
import { GoogleVerificationService } from '../payment/google-verification.service';
import { AppleVerificationService } from '../payment/apple-verification.service';
import {
  ADMIN_ACTIVATED_TOKEN_PREFIX,
  PRODUCT_ID_TO_PLAN,
  SUBSCRIPTION_SOURCE,
  hasRealStoreToken,
} from '../subscription/subscription.constants';
import {
  IAdminUserRepository,
  ADMIN_USER_REPOSITORY,
  IAdminSubscriptionRepository,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  IAdminActivityRepository,
  ADMIN_ACTIVITY_REPOSITORY,
} from './repositories';

@Injectable()
export class AdminSubscriptionOpsService {
  private readonly logger = new Logger(AdminSubscriptionOpsService.name);

  constructor(
    @Inject(ADMIN_USER_REPOSITORY)
    private readonly userRepo: IAdminUserRepository,
    @Inject(ADMIN_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepo: IAdminSubscriptionRepository,
    @Inject(ADMIN_ACTIVITY_REPOSITORY)
    private readonly activityRepo: IAdminActivityRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly googleVerificationService: GoogleVerificationService,
    private readonly appleVerificationService: AppleVerificationService,
  ) {}

  /**
   * Manually activate or update a subscription for a user.
   * Used when Google Play/Apple subscriptions weren't detected automatically.
   */
  async activateSubscription(
    userId: string,
    dto: ActivateSubscriptionDto,
    adminUserId: string,
  ) {
    const now = new Date();
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= now) {
      throw new BadRequestException('endsAt must be a future date');
    }

    const user = await this.userRepo.findActiveById(userId);
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const existingSub = await this.subscriptionRepo.findByUserId(userId);

    // A live store subscription owns the user's single Subscription row, and
    // the Apple/Google webhooks find it by its real purchaseToken. Overwriting
    // that token with a synthetic one would orphan the store subscription
    // (later renewals/cancellations/refunds would be ignored). Refuse; admin
    // activation stays allowed over expired/cancelled/free/granted/missing rows.
    if (
      existingSub &&
      hasRealStoreToken(existingSub) &&
      existingSub.status === 'active' &&
      existingSub.endsAt != null &&
      existingSub.endsAt > now
    ) {
      await this.activityRepo.createLog({
        userId,
        action: 'ADMIN_ACTIVATE_SUBSCRIPTION',
        status: 'FAILED',
        details: JSON.stringify({
          reason: 'ACTIVE_STORE_SUBSCRIPTION',
          requestedPlan: dto.plan,
          requestedPlatform: dto.platform,
          existingPlan: existingSub.plan,
          existingPlatform: existingSub.platform,
          existingEndsAt: existingSub.endsAt,
          adminReason: dto.reason,
          adminUserId,
        }),
      });
      this.logger.warn(
        `Admin ${adminUserId} activation refused for user ${userId}: active store subscription (${existingSub.platform}) until ${existingSub.endsAt.toISOString()}`,
      );
      throw new ConflictException(
        'This user has an active store subscription (Apple/Google). Wait for it to expire, or cancel it in the store first, before granting admin access.',
      );
    }

    // Admin activation is always a complimentary grant: it is not backed by a
    // store purchase, so it must never count as a paying customer. The grant
    // fields are replaced on every (re)activation; a later real store purchase
    // clears them (see PaymentService.upsertSubscriptionWithExpiry).
    const grant = {
      source: SUBSCRIPTION_SOURCE.ADMIN_GRANT,
      grantedByAdminId: adminUserId,
      grantReason: dto.reason,
    };

    const subscription = await this.subscriptionRepo.upsertForActivation({
      userId,
      create: {
        userId,
        plan: dto.plan,
        status: 'active',
        platform: dto.platform,
        productId: dto.productId ?? null,
        startedAt: now,
        endsAt,
        purchaseToken: `${ADMIN_ACTIVATED_TOKEN_PREFIX}${Date.now()}`,
        ...grant,
      },
      update: {
        plan: dto.plan,
        status: 'active',
        platform: dto.platform,
        productId: dto.productId ?? null,
        startedAt: now,
        endsAt,
        purchaseToken: `${ADMIN_ACTIVATED_TOKEN_PREFIX}${Date.now()}`,
        ...grant,
        isDeleted: false,
        deletedAt: null,
      },
    });

    this.logger.log(
      `Admin ${adminUserId} activated subscription for user ${userId}: ` +
        `plan=${dto.plan}, platform=${dto.platform}, endsAt=${dto.endsAt}, reason="${dto.reason}"`,
    );

    await this.activityRepo.createLog({
      userId,
      action: 'ADMIN_ACTIVATE_SUBSCRIPTION',
      status: 'SUCCESS',
      details: JSON.stringify({
        plan: dto.plan,
        platform: dto.platform,
        endsAt: dto.endsAt,
        reason: dto.reason,
        adminUserId,
        isRenewal: !!existingSub,
      }),
    });

    this.eventEmitter.emit('admin.sse.activity', {
      type: 'SUBSCRIPTION',
      userId,
      timestamp: now.toISOString(),
    });
    this.eventEmitter.emit('admin.sse.stats', {
      trigger: existingSub ? 'subscription_renewed' : 'subscription_created',
    });

    return subscription;
  }

  /**
   * Verify a purchase receipt on behalf of a user without creating a subscription.
   * Returns the verification result for admin inspection.
   */
  async verifyUserPurchase(userId: string, dto: VerifyPurchaseDto) {
    const user = await this.userRepo.findActiveById(userId);
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    try {
      let result;
      if (dto.platform === 'google') {
        result = await this.googleVerificationService.verify({
          purchaseToken: dto.purchaseToken,
          productId: dto.productId,
          packageName: dto.packageName,
        });
      } else {
        result = await this.appleVerificationService.verify({
          transactionId: dto.purchaseToken,
          productId: dto.productId,
        });
      }

      const plan = PRODUCT_ID_TO_PLAN[dto.productId] ?? null;

      this.logger.log(
        `Admin verified purchase for user ${userId}: ` +
          `platform=${dto.platform}, productId=${dto.productId}, success=${result.success}`,
      );

      return {
        success: result.success,
        productId: dto.productId,
        plan,
        expirationTime: result.expirationTime ?? null,
        platform: dto.platform,
        metadata: result.metadata ?? {},
      };
    } catch (error) {
      this.logger.warn(
        `Admin purchase verification failed for user ${userId}: ${error.message}`,
      );

      return {
        success: false,
        productId: dto.productId,
        plan: PRODUCT_ID_TO_PLAN[dto.productId] ?? null,
        expirationTime: null,
        platform: dto.platform,
        error: error.message ?? 'Verification failed',
      };
    }
  }
}
