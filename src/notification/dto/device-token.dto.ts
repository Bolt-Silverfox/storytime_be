import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

/**
 * Supported device platforms for FCM
 */
export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

/**
 * DTO for registering a new device token
 */
export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'FCM device token',
    example: 'dGhpcyBpcyBhIHNhbXBsZSB0b2tlbg...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: 'Device platform',
    enum: DevicePlatform,
    example: DevicePlatform.IOS,
  })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @ApiPropertyOptional({
    description: 'Optional device name for identification',
    example: 'iPhone 15 Pro',
  })
  @IsString()
  @IsOptional()
  deviceName?: string;
}

/**
 * Response DTO for a device token
 */
export class DeviceTokenResponseDto {
  @ApiProperty({ description: 'Device token ID' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({
    description: 'FCM device token (masked)',
    example: 'dGhp...g==',
  })
  token: string;

  @ApiProperty({
    description: 'Device platform',
    enum: DevicePlatform,
  })
  platform: string;

  @ApiPropertyOptional({ description: 'Device name' })
  deviceName?: string;

  @ApiProperty({ description: 'Whether the token is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Registration date' })
  createdAt: Date;

  @ApiProperty({ description: 'Last updated date' })
  updatedAt: Date;
}

/**
 * Response for list of device tokens
 */
export class DeviceTokenListResponseDto {
  @ApiProperty({
    type: [DeviceTokenResponseDto],
    description: 'List of registered device tokens',
  })
  devices: DeviceTokenResponseDto[];

  @ApiProperty({ description: 'Total number of devices' })
  total: number;
}

/**
 * DTO for sending a test push notification
 */
export class TestPushNotificationDto {
  @ApiPropertyOptional({
    description:
      'Target device token (if not provided, sends to all user devices)',
  })
  @IsString()
  @IsOptional()
  token?: string;

  @ApiProperty({
    description: 'Notification title',
    example: 'Test Notification',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Notification body',
    example: 'This is a test push notification',
  })
  @IsString()
  @IsNotEmpty()
  body: string;
}
