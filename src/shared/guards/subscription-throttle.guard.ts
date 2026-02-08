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
import { SubscriptionService } from '../../subscription/subscription.service';

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
    private readonly subscriptionService: SubscriptionService,
  ) {
    super(options, storageService, reflector);
  }

  async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, limit } = requestProps;

    const request = context.switchToHttp().getRequest();
    const user = request.authUserData;

    // Check if user has active premium subscription (cached)
    const userId = (user as { userId?: string } | undefined)?.userId;
    const isPremium = userId
      ? await this.subscriptionService.isPremiumUser(userId)
      : false;

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

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const authData = req?.authUserData as { userId?: string } | undefined;
    return Promise.resolve(authData?.userId || (req.ip as string));
  }
}
