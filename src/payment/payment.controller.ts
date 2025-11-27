import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { AuthSessionGuard } from '../auth/auth.guard';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { ChargeSubscriptionDto } from './dto/charge-subscription.dto';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('methods')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add payment method' })
  async addMethod(@Req() req: any, @Body() body: CreatePaymentMethodDto) {
    return this.paymentService.addPaymentMethod(req.authUserData.userId, body);
  }

  @Get('methods')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my payment methods' })
  async listMethods(@Req() req: any) {
    return this.paymentService.listPaymentMethods(req.authUserData.userId);
  }

  @Delete('methods/:id')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove payment method' })
  async removeMethod(@Req() req: any, @Param('id') id: string) {
    return this.paymentService.removePaymentMethod(req.authUserData.userId, id);
  }

  @Post('subscribe')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe / change plan (charges payment if required)' })
  @ApiBody({ type: ChargeSubscriptionDto })
  async subscribe(@Req() req: any, @Body() body: ChargeSubscriptionDto) {
    return this.paymentService.chargeSubscription(req.authUserData.userId, body);
  }

  @Post('resubscribe')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resubscribe (recharge existing or new plan)' })
  @ApiBody({ type: ChargeSubscriptionDto })
  async resubscribe(@Req() req: any, @Body() body: ChargeSubscriptionDto) {
    return this.paymentService.resubscribe(req.authUserData.userId, body.paymentMethodId, body.plan, body.transactionPin);
  }

  @Post('cancel')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel subscription (keeps access until endsAt)' })
  async cancel(@Req() req: any) {
    return this.paymentService.cancelSubscription(req.authUserData.userId);
  }

  @Get('status')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current subscription (helper endpoint)' })
  async status(@Req() req: any) {
    return this.paymentService.getSubscription(req.authUserData.userId);
  }
}
