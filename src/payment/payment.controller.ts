import { Controller, Post, Body, UseGuards, Req, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { VerifyPurchaseDto } from './dto/verify-purchase.dto';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('verify-purchase')
  @UseGuards(AuthSessionGuard, ThrottlerGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.PAYMENT.VERIFY_PURCHASE.LIMIT,
      ttl: THROTTLE_LIMITS.PAYMENT.VERIFY_PURCHASE.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify an In-App Purchase from Google Play or App Store',
    description:
      'Validates the purchase token with the respective platform and creates/updates the subscription',
  })
  @ApiBody({ type: VerifyPurchaseDto })
  async verifyPurchase(
    @Req() req: AuthenticatedRequest,
    @Body() body: VerifyPurchaseDto,
  ) {
    return this.paymentService.verifyPurchase(req.authUserData.userId, body);
  }

  @Post('cancel')
  @UseGuards(AuthSessionGuard, ThrottlerGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.PAYMENT.CANCEL.LIMIT,
      ttl: THROTTLE_LIMITS.PAYMENT.CANCEL.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription (keeps access until endsAt)' })
  async cancel(@Req() req: AuthenticatedRequest) {
    return this.paymentService.cancelSubscription(req.authUserData.userId);
  }

  @Get('status')
  @UseGuards(AuthSessionGuard, ThrottlerGuard)
  @Throttle({
    short: {
      limit: THROTTLE_LIMITS.PAYMENT.STATUS.LIMIT,
      ttl: THROTTLE_LIMITS.PAYMENT.STATUS.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current subscription status' })
  async status(@Req() req: AuthenticatedRequest) {
    return this.paymentService.getSubscription(req.authUserData.userId);
  }
}
