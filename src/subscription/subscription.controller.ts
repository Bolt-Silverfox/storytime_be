import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SubscriptionService } from './subscription.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { SubscribeDto } from './dto/subscribe.dto';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';

@ApiTags('subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('plans')
  @ApiOperation({ summary: 'List available subscription plans' })
  getPlans() {
    return this.subscriptionService.getPlans();
  }

  @Get('me')
  @UseGuards(AuthSessionGuard)
  @Throttle({
    default: {
      limit: THROTTLE_LIMITS.SUBSCRIPTION.STATUS.LIMIT,
      ttl: THROTTLE_LIMITS.SUBSCRIPTION.STATUS.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user subscription' })
  async getMySubscription(@Req() req: any) {
    return this.subscriptionService.getSubscriptionForUser(req.authUserData.userId);
  }

  @Post('subscribe')
  @UseGuards(AuthSessionGuard)
  @Throttle({
    default: {
      limit: THROTTLE_LIMITS.SUBSCRIPTION.SUBSCRIBE.LIMIT,
      ttl: THROTTLE_LIMITS.SUBSCRIPTION.SUBSCRIBE.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiBody({ type: SubscribeDto })
  @ApiOperation({ summary: 'Subscribe / change plan (optionally perform charge)' })
  async subscribe(@Req() req: any, @Body() body: SubscribeDto) {
    return this.subscriptionService.subscribe(req.authUserData.userId, body.plan, { paymentMethodId: body.paymentMethodId, transactionPin: body.transactionPin, charge: body.charge });
  }

  @Post('cancel')
  @UseGuards(AuthSessionGuard)
  @Throttle({
    default: {
      limit: THROTTLE_LIMITS.SUBSCRIPTION.CANCEL.LIMIT,
      ttl: THROTTLE_LIMITS.SUBSCRIPTION.CANCEL.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription (keeps access until endsAt)' })
  async cancel(@Req() req: any) {
    return this.subscriptionService.cancel(req.authUserData.userId);
  }

  @Post('reactivate')
  @UseGuards(AuthSessionGuard)
  @Throttle({
    default: {
      limit: THROTTLE_LIMITS.SUBSCRIPTION.SUBSCRIBE.LIMIT,
      ttl: THROTTLE_LIMITS.SUBSCRIPTION.SUBSCRIBE.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reactivate / resubscribe' })
  @ApiBody({ type: SubscribeDto })
  async reactivate(@Req() req: any, @Body() body: SubscribeDto) {
    return this.subscriptionService.reactivate(req.authUserData.userId, body.plan, { paymentMethodId: body.paymentMethodId, charge: body.charge, transactionPin: body.transactionPin });
  }

  @Get('history')
  @UseGuards(AuthSessionGuard)
  @Throttle({
    default: {
      limit: THROTTLE_LIMITS.SUBSCRIPTION.HISTORY.LIMIT,
      ttl: THROTTLE_LIMITS.SUBSCRIPTION.HISTORY.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payment transactions for user' })
  async history(@Req() req: any) {
    return this.subscriptionService.listHistory(req.authUserData.userId);
  }
}
