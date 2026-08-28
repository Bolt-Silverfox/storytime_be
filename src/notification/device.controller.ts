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
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { DeviceTokenService } from './services/device-token.service';
import { NotificationService } from './notification.service';
import { TestPushNotificationDto } from './dto/device-token.dto';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LIMITS } from '@/shared/config/throttle.config';
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

class UnregisterDeviceDto {
  // Optional: when present, DELETE /devices unregisters only this device
  // (the v1.2.0 logout contract, which sends { token } in the body). When
  // absent, DELETE /devices unregisters all of the user's devices.
  // @IsNotEmpty rejects an explicit empty string ("") so a malformed
  // { token: "" } body is a 400 rather than silently falling through to the
  // "unregister ALL devices" branch. @IsOptional still allows the token to be
  // omitted entirely (the unregister-all contract).
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  token?: string;
}

@ApiTags('Devices')
@Controller('devices')
export class DeviceController {
  constructor(
    private readonly deviceTokenService: DeviceTokenService,
    private readonly notificationService: NotificationService,
  ) {}

  @Post('register')
  @UseGuards(AuthSessionGuard)
  @Throttle({
    default: {
      limit: THROTTLE_LIMITS.DEVICE_REGISTER.limit,
      ttl: THROTTLE_LIMITS.DEVICE_REGISTER.ttl,
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
  @ApiResponse({
    status: 403,
    description: 'Cannot unregister another user device',
  })
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
  @ApiOperation({
    summary: 'Unregister devices',
    description:
      'With a { token } body, unregisters only that device (the v1.2.0 logout ' +
      'contract). With no body, unregisters all devices for the user.',
  })
  @ApiBody({ type: UnregisterDeviceDto, required: false })
  @ApiResponse({
    status: 200,
    description:
      'Device(s) unregistered. Returns { success } for a single token, ' +
      '{ count } when unregistering all.',
  })
  async unregisterDevices(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UnregisterDeviceDto,
  ) {
    // Preserve the v1.2.0 logout semantics: DELETE /devices with a { token }
    // body removes just that one device. Older clients (app 1.2.0) rely on
    // this to unregister only the device logging out; treating it as
    // "unregister all" silently killed push on the user's other devices.
    if (dto?.token) {
      return this.deviceTokenService.unregisterDeviceToken(
        req.authUserData.userId,
        dto.token,
      );
    }
    return this.deviceTokenService.unregisterAllUserTokens(
      req.authUserData.userId,
    );
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Send a test push notification',
    description:
      "Sends a test push notification to the authenticated user's devices. " +
      'Useful for verifying that push notifications are configured correctly.',
  })
  @ApiResponse({ status: 200, description: 'Test notification sent' })
  async sendTestPush(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TestPushNotificationDto,
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.authUserData.userId;
    const result = await this.notificationService.sendTestPush(
      userId,
      dto.title,
      dto.body,
      dto.token,
    );
    return {
      success: result.success,
      message: result.success
        ? 'Test notification sent successfully'
        : result.error || 'Failed to send test notification',
    };
  }
}
