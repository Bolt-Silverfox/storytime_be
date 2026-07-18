import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { Admin } from './decorators/admin.decorator';
import {
  CreateCouponDto,
  UpdateCouponDto,
  ValidateCouponDto,
  RedeemCouponDto,
} from './dto/coupon.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminCouponController {
  constructor(private readonly adminService: AdminService) {}

  // =====================
  // COUPONS
  // =====================

  @Post('coupons')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a coupon' })
  @ApiBody({ type: CreateCouponDto })
  @ApiCreatedResponse({ description: 'Coupon created' })
  @HttpCode(HttpStatus.CREATED)
  async createCoupon(@Body() body: CreateCouponDto) {
    const data = await this.adminService.createCoupon(body);
    return { statusCode: 201, message: 'Coupon created', data };
  }

  @Get('coupons')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List coupons (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiOkResponse({ description: 'Paginated list of coupons' })
  async listCoupons(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isActive') isActive?: string,
  ) {
    const data = await this.adminService.listCoupons(
      Math.max(1, parseInt(page ?? '1') || 1),
      Math.min(100, Math.max(1, parseInt(limit ?? '20') || 20)),
      isActive === undefined ? undefined : isActive === 'true',
    );
    return { statusCode: 200, ...data };
  }

  @Get('coupons/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get coupon details with redemptions' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'Coupon details' })
  async getCoupon(@Param('id') id: string) {
    const data = await this.adminService.getCouponById(id);
    return { statusCode: 200, data };
  }

  @Patch('coupons/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a coupon' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateCouponDto })
  @ApiOkResponse({ description: 'Coupon updated' })
  async updateCoupon(@Param('id') id: string, @Body() body: UpdateCouponDto) {
    const data = await this.adminService.updateCoupon(id, body);
    return { statusCode: 200, message: 'Coupon updated', data };
  }

  @Delete('coupons/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a coupon (deactivate)' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Coupon deactivated' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCoupon(@Param('id') id: string) {
    await this.adminService.deleteCoupon(id);
  }

  @Post('coupons/:code/validate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate a coupon code' })
  @ApiParam({ name: 'code', type: String })
  @ApiBody({ type: ValidateCouponDto })
  @ApiOkResponse({ description: 'Coupon validation result' })
  async validateCoupon(
    @Param('code') code: string,
    @Body() body: ValidateCouponDto,
  ) {
    const data = await this.adminService.validateCoupon(code, body.plan);
    return { statusCode: 200, data };
  }

  @Post('coupons/:code/redeem')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Redeem a coupon for a user' })
  @ApiParam({ name: 'code', type: String })
  @ApiBody({ type: RedeemCouponDto })
  @ApiCreatedResponse({ description: 'Coupon redeemed' })
  @HttpCode(HttpStatus.CREATED)
  async redeemCoupon(
    @Param('code') code: string,
    @Body() body: RedeemCouponDto,
  ) {
    const data = await this.adminService.redeemCoupon(code, body.userId);
    return { statusCode: 201, message: 'Coupon redeemed', data };
  }
}
