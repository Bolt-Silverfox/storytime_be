import { Controller, Get, Post, Body, UseGuards, Req, Delete } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { SubscriptionService } from './subscription.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
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
  async getMySubscription(@Req() req: any) {
    return this.subscriptionService.getSubscriptionForUser(req.authUserData.userId);
  }

  @Post('subscribe')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiBody({ type: SubscribeDto })
  @ApiOperation({ summary: 'Subscribe / change plan (optionally perform charge)' })
  async subscribe(@Req() req: any, @Body() body: SubscribeDto) {
    return this.subscriptionService.subscribe(req.authUserData.userId, body.plan, { paymentMethodId: body.paymentMethodId, transactionPin: body.transactionPin, charge: body.charge });
  }

  @Post('cancel')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription (keeps access until endsAt)' })
  async cancel(@Req() req: any) {
    return this.subscriptionService.cancel(req.authUserData.userId);
  }

  @Post('reactivate')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reactivate / resubscribe' })
  @ApiBody({ type: SubscribeDto })
  async reactivate(@Req() req: any, @Body() body: SubscribeDto) {
    return this.subscriptionService.reactivate(req.authUserData.userId, body.plan, { paymentMethodId: body.paymentMethodId, charge: body.charge, transactionPin: body.transactionPin });
  }

  @Get('history')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List payment transactions for user' })
  async history(@Req() req: any) {
    return this.subscriptionService.listHistory(req.authUserData.userId);
  }
}
