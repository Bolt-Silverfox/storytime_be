import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export enum SubscriptionPlan {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum SubscriptionPlatform {
  GOOGLE = 'google',
  APPLE = 'apple',
}

export class ActivateSubscriptionDto {
  @ApiProperty({ enum: SubscriptionPlan, description: 'Subscription plan type' })
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  @ApiProperty({ enum: SubscriptionPlatform, description: 'Payment platform' })
  @IsEnum(SubscriptionPlatform)
  platform: SubscriptionPlatform;

  @ApiPropertyOptional({
    description: 'Platform product ID (e.g. com.storytime.monthly)',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({ description: 'Subscription end date (ISO 8601)' })
  @IsDateString()
  endsAt: string;

  @ApiProperty({ description: 'Reason for manual activation (audit trail)' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
