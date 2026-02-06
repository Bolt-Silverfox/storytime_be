import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { VerifyPurchaseDto } from './dto/verify-purchase.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('verify-purchase')
  @UseGuards(AuthSessionGuard)
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
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription (keeps access until endsAt)' })
  async cancel(@Req() req: AuthenticatedRequest) {
    return this.paymentService.cancelSubscription(req.authUserData.userId);
  }

  @Get('status')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current subscription status' })
  async status(@Req() req: AuthenticatedRequest) {
    return this.paymentService.getSubscription(req.authUserData.userId);
  }
}
