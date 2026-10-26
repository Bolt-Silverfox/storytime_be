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
import { AdminAuditLogService } from './admin-audit-log.service';
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
  constructor(
    private readonly adminService: AdminService,
    private readonly auditLog: AdminAuditLogService,
  ) {}

  // =====================
  // SUBSCRIPTION ACTIVATION
  // =====================

  @Post('users/:userId/activate-subscription')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Manually activate subscription for a user',
    description:
      "Creates or replaces the user's subscription as a COMPLIMENTARY grant (source=admin_grant) with full paid access. The calling admin and the required `reason` are stored on the subscription (grantedByAdminId, grantReason). Grants are excluded from paying-customer, conversion, churn and revenue figures. A later real store purchase by the user replaces the grant (source back to store, grant fields cleared). REFUSED with 409 when the user has a live store subscription (source=store, active, endsAt in the future, real Apple/Google purchaseToken): overwriting its token would orphan the store subscription and make later renewal/cancel/refund webhooks be ignored. Allowed when the existing row is expired, cancelled, free, an earlier admin grant, or absent. Refused attempts are written to the admin activity log.",
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({ type: ActivateSubscriptionDto })
  @ApiCreatedResponse({ description: 'Subscription activated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 409,
    description:
      'User has an active store subscription (Apple/Google); wait for it to expire or cancel it in the store first',
  })
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
    await this.auditLog.record({
      adminId: req.authUserData.userId,
      adminEmail: req.authUserData.email,
      action: 'subscription.manual_activate',
      targetType: 'Subscription',
      targetId: userId,
      details: dto as unknown as Record<string, unknown>,
    });
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
