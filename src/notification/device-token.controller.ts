import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { DeviceTokenService } from './services/device-token.service';
import {
  RegisterDeviceTokenDto,
  DeviceTokenResponseDto,
  DeviceTokenListResponseDto,
  TestPushNotificationDto,
  UnregisterDeviceDto,
} from './dto/device-token.dto';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    userId: string;
    email: string;
  };
}

@ApiTags('device-tokens')
@ApiBearerAuth()
@UseGuards(AuthSessionGuard)
@Controller('devices')
export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a device token for push notifications',
    description:
      'Registers or updates an FCM device token for the authenticated user. ' +
      'If the token already exists for this user, the device info is updated. ' +
      'If the token exists for a different user, it is reassigned.',
  })
  @ApiResponse({
    status: 201,
    description: 'Device token registered successfully',
    type: DeviceTokenResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async registerDevice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    const userId = req.user.userId;
    return this.deviceTokenService.registerDeviceToken(
      userId,
      dto.token,
      dto.platform,
      dto.deviceName,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Get all registered devices for the current user',
    description:
      'Returns a list of all active device tokens registered by the user.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of registered devices',
    type: DeviceTokenListResponseDto,
  })
  async getDevices(
    @Req() req: AuthenticatedRequest,
  ): Promise<DeviceTokenListResponseDto> {
    const userId = req.user.userId;
    return this.deviceTokenService.getUserDevices(userId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Unregister a device token',
    description:
      "Removes a device token from the user's registered devices. " +
      'Use this when the user logs out or disables push notifications.',
  })
  @ApiResponse({
    status: 204,
    description: 'Device token removed successfully',
  })
  @ApiResponse({ status: 404, description: 'Device token not found' })
  async unregisterDevice(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UnregisterDeviceDto,
  ): Promise<void> {
    const userId = req.user.userId;
    await this.deviceTokenService.unregisterDeviceToken(userId, dto.token);
  }

  @Post('test')
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
    const userId = req.user.userId;
    const result = await this.deviceTokenService.sendTestPush(
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
