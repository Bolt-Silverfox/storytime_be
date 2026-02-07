import { ApiProperty, ApiHideProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, IsObject } from 'class-validator';

export class AnalyticsStatsDto {
  @ApiProperty()
  userCount: number;
  @ApiProperty()
  storyCount: number;
  @ApiProperty()
  kidCount: number;
  @ApiProperty()
  rewardCount: number;
}

export class CreateActivityLogDto {
  @ApiProperty({
    required: false,
    description: 'Kid ID for the activity',
    example: '1f8951d0-bbed-42ca-b091-2565c77c316f',
  })
  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;

  @ApiProperty({
    required: false,
    description: 'Kid ID for the activity',
    example: 'c182daa8-723c-4020-bcd4-ad01cb026b90',
  })
  @IsOptional()
  @IsUUID('4', { message: 'kidId must be a valid UUID' })
  kidId?: string;

  @ApiProperty({
    required: true,
    description: 'Action performed',
    example: 'START_STORY',
  })
  @IsString({ message: 'action must be a string' })
  action: string;

  @ApiProperty({
    required: true,
    description: 'Status of the action',
    example: 'SUCCESS',
  })
  @IsString({ message: 'status must be a string' })
  status: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  deviceName?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  deviceModel?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  os?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiProperty({
    required: false,
    description: 'Additional details (optional)',
    example: 'Started story from bedtime reading',
  })
  @IsOptional()
  @IsString()
  details?: string;
}

export class ActivityLogDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ required: false })
  userId?: string;

  @ApiProperty({ required: false })
  kidId?: string;

  @ApiProperty()
  action: string;

  @ApiProperty({
    required: true,
    description: 'Status of the action (e.g. SUCCESS, FAILED)',
  })
  status: string;

  @ApiProperty({ required: false, description: 'Device name' })
  deviceName?: string;

  @ApiProperty({ required: false, description: 'Device model' })
  deviceModel?: string;

  @ApiProperty({ required: false, description: 'Operating system' })
  os?: string;

  @ApiProperty({ required: false, description: 'IP address of the device' })
  ipAddress?: string;

  @ApiProperty({
    required: false,
    description: 'Additional details (optional)',
  })
  details?: string;

  @ApiProperty()
  createdAt: Date;
}
