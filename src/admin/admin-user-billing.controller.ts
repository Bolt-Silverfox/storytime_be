import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { Admin } from './decorators/admin.decorator';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { VerifyPurchaseDto } from '../payment/dto/verify-purchase.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminUserBillingController {
  constructor(private readonly adminService: AdminService) {}

  // =====================
  // SUBSCRIPTION ACTIVATION
  // =====================

  @Post('users/:userId/activate-subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually activate subscription for a user' })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({ type: ActivateSubscriptionDto })
  @ApiCreatedResponse({ description: 'Subscription activated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @HttpCode(HttpStatus.CREATED)
  async activateSubscription(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ActivateSubscriptionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const subscription = await this.adminService.activateSubscription(
      userId,
      dto,
      req.authUserData.userId,
    );
    return {
      statusCode: 201,
      message: 'Subscription activated successfully',
      data: subscription,
    };
  }

  // =====================
  // PURCHASE VERIFICATION
  // =====================

  @Post('users/:userId/verify-purchase')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify a purchase receipt on behalf of a user' })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({ type: VerifyPurchaseDto })
  @ApiOkResponse({ description: 'Purchase verification result' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @HttpCode(HttpStatus.OK)
  async verifyPurchase(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: VerifyPurchaseDto,
  ) {
    const result = await this.adminService.verifyUserPurchase(userId, dto);
    return {
      statusCode: 200,
      message: result.success
        ? 'Purchase verified successfully'
        : 'Purchase verification failed',
      data: result,
    };
  }
}
