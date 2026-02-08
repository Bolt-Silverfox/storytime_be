import { Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerRequest,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

import { THROTTLE_LIMITS } from '../constants/throttle.constants';

/**
 * Custom throttle guard that adjusts rate limits based on user subscription status
 * Premium users get 5x the rate limit of free users
 */
@Injectable()
export class SubscriptionThrottleGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(options, storageService, reflector);
  }

  async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit } = requestProps;

    const request = context.switchToHttp().getRequest();
    const user = request.authUserData;

    // Check if user has active premium subscription
    const isPremium = await this.checkPremiumStatus(user?.userId);

    // Adjust limits based on subscription
    const adjustedLimit = isPremium
      ? limit * THROTTLE_LIMITS.PREMIUM_MULTIPLIER
      : limit;

    // Call parent with adjusted limit
    return super.handleRequest({
      ...requestProps,
      limit: adjustedLimit,
    });
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req?.authUserData?.userId || req.ip;
  }

  private async checkPremiumStatus(userId?: string): Promise<boolean> {
    if (!userId) return false;

    try {
      const subscription = await this.prisma.subscription.findFirst({
        where: {
          userId,
          status: 'active',
          endsAt: { gt: new Date() },
        },
      });

      return !!subscription;
    } catch (error) {
      // If there's an error checking subscription, default to free tier
      return false;
    }
  }
}
