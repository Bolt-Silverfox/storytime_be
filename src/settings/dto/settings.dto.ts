import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateSettingsDto {
  @ApiProperty({
    example: false,
    description: 'Allow explicit content in stories',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  explicitContent?: boolean;

  @ApiProperty({
    example: 120,
    description: 'Default daily screen time limit in minutes for all kids',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1440) // max 24 hours
  maxScreenTimeMins?: number;

  @ApiProperty({
    example: 'en',
    description: 'Interface language code',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  language?: string;

  @ApiProperty({
    example: 'NG',
    description: 'Country code (ISO 3166-1 alpha-2)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  country?: string;
}

export class SetKidDailyLimitDto {
  @ApiProperty({
    example: 120,
    description:
      'Daily screen time limit in minutes. Set null to use parent default.',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1440)
  limitMins?: number;
}

export class SettingsResponseDto {
  @ApiProperty({ example: 'user-uuid' })
  userId: string;

  @ApiProperty({ example: false })
  explicitContent: boolean;

  @ApiProperty({ example: 60 })
  maxScreenTimeMins: number | null;

  @ApiProperty({ example: 'en' })
  language: string | null;

  @ApiProperty({ example: 'NG' })
  country: string | null;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;
}

export class KidDailyLimitResponseDto {
  @ApiProperty({ example: 'kid-uuid' })
  kidId: string;

  @ApiProperty({ example: 120 })
  limitMins: number | null;

  @ApiProperty({
    example: 'kid',
    description:
      'Source of the limit: "kid" (custom), "parent" (default), or "none"',
  })
  source: 'kid' | 'parent' | 'none';
}

export class KidScreenTimeSettingDto {
  @ApiProperty({ example: 'kid-uuid' })
  kidId: string;

  @ApiProperty({ example: 'Jacob' })
  kidName: string;

  @ApiProperty({ example: 'https://storage.com/avatar.jpg' })
  avatarUrl: string | null;

  @ApiProperty({
    example: 120,
    description: 'Custom limit set for this kid, null if using parent default',
  })
  customLimit: number | null;

  @ApiProperty({
    example: 120,
    description: 'The actual limit being used (custom or parent default)',
  })
  effectiveLimit: number | null;

  @ApiProperty({ example: true, description: 'Whether kid has a custom limit' })
  isCustom: boolean;
}

export class ApplyDefaultResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 60 })
  appliedLimit: number;

  @ApiProperty({ example: 2 })
  kidsUpdated: number;
}

export class SetKidLimitResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'kid-uuid' })
  kidId: string;

  @ApiProperty({ example: 120 })
  limitMins: number | null;
}
