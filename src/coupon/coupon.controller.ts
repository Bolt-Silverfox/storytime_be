import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CouponService } from './coupon.service';
import { UserCouponCodeDto } from './dto/user-coupon.dto';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';

@ApiBearerAuth()
@Controller('coupons')
@UseGuards(AuthSessionGuard)
@ApiTags('coupons')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if a coupon code is valid for this user' })
  @ApiBody({ type: UserCouponCodeDto })
  @ApiOkResponse({
    description: 'Validation result',
    schema: {
      example: {
        valid: true,
        freeDays: 7,
        message: 'This coupon gives you 7 days of free premium access!',
      },
    },
  })
  async validateCoupon(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UserCouponCodeDto,
  ) {
    return this.couponService.validateCoupon(req.authUserData.userId, dto.code);
  }

  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Redeem a coupon code for free premium access' })
  @ApiBody({ type: UserCouponCodeDto })
  @ApiOkResponse({
    description: 'Redemption result with new premium access expiry',
    schema: {
      example: {
        success: true,
        premiumAccessUntil: '2026-03-10T12:00:00.000Z',
        freeDays: 7,
        message:
          'You have 7 days of free premium access! Enjoy until 3/10/2026.',
      },
    },
  })
  async redeemCoupon(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UserCouponCodeDto,
  ) {
    return this.couponService.redeemCoupon(req.authUserData.userId, dto.code);
  }
}
