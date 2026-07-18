import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { VerifyPurchaseDto } from '../payment/dto/verify-purchase.dto';
import { GoogleVerificationService } from '../payment/google-verification.service';
import { AppleVerificationService } from '../payment/apple-verification.service';
import { PRODUCT_ID_TO_PLAN } from '../subscription/subscription.constants';
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
        purchaseToken: `admin-activated-${Date.now()}`,
      },
      update: {
        plan: dto.plan,
        status: 'active',
        platform: dto.platform,
        productId: dto.productId ?? null,
        startedAt: now,
        endsAt,
        purchaseToken: `admin-activated-${Date.now()}`,
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
