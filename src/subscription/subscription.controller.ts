import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { SubscribeDto } from './dto/subscribe.dto';

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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user subscription' })
  async getMySubscription(@Req() req: AuthenticatedRequest) {
    return this.subscriptionService.getSubscriptionForUser(
      req.authUserData.userId,
    );
  }

  @Post('subscribe')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiBody({ type: SubscribeDto })
  @ApiOperation({
    summary: 'Subscribe to free plan (paid plans require IAP)',
    description:
      'For paid plans, complete the In-App Purchase first then use /payment/verify-purchase',
  })
  async subscribe(
    @Req() req: AuthenticatedRequest,
    @Body() body: SubscribeDto,
  ) {
    return this.subscriptionService.subscribe(
      req.authUserData.userId,
      body.plan,
    );
  }

  @Post('cancel')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription (keeps access until endsAt)' })
  async cancel(@Req() req: AuthenticatedRequest) {
    return this.subscriptionService.cancel(req.authUserData.userId);
  }

  @Get('history')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payment transactions for user' })
  async history(@Req() req: AuthenticatedRequest) {
    return this.subscriptionService.listHistory(req.authUserData.userId);
  }
}
