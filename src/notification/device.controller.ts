import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { AuthSessionGuard, AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { DeviceTokenService } from './services/device-token.service';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';
import { DevicePlatform } from '@prisma/client';

class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @IsString()
  @IsOptional()
  deviceName?: string;
}

@ApiTags('Devices')
@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  @Post('register')
  @UseGuards(AuthSessionGuard)
  @Throttle({
    default: {
      limit: THROTTLE_LIMITS.DEVICE.REGISTER.LIMIT,
      ttl: THROTTLE_LIMITS.DEVICE.REGISTER.TTL,
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register device for push notifications' })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiResponse({
    status: 201,
    description: 'Device registered successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        platform: { type: 'string', enum: ['ios', 'android', 'web'] },
        isActive: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        lastUsed: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerDevice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.deviceTokenService.registerDeviceToken(
      req.authUserData.userId,
      dto,
    );
  }

  @Delete(':token')
  @UseGuards(AuthSessionGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unregister device from push notifications' })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({
    status: 200,
    description: 'Device unregistered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Device token not found' })
  @ApiResponse({ status: 403, description: 'Cannot unregister another user device' })
  async unregisterDevice(
    @Req() req: AuthenticatedRequest,
    @Param('token') token: string,
  ) {
    return this.deviceTokenService.unregisterDeviceToken(
      req.authUserData.userId,
      token,
    );
  }

  @Get()
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all registered devices for current user' })
  @ApiResponse({
    status: 200,
    description: 'List of registered devices',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          platform: { type: 'string', enum: ['ios', 'android', 'web'] },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          lastUsed: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async getDevices(@Req() req: AuthenticatedRequest) {
    return this.deviceTokenService.getUserDeviceTokens(req.authUserData.userId);
  }

  @Delete()
  @UseGuards(AuthSessionGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unregister all devices (logout from all devices)' })
  @ApiResponse({
    status: 200,
    description: 'All devices unregistered',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of devices unregistered' },
      },
    },
  })
  async unregisterAllDevices(@Req() req: AuthenticatedRequest) {
    return this.deviceTokenService.unregisterAllUserTokens(
      req.authUserData.userId,
    );
  }
}
