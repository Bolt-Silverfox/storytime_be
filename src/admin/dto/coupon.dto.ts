import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CouponType } from '@prisma/client';

export class CreateCouponDto {
  @ApiProperty({ example: 'SUMMER25' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ enum: CouponType })
  @IsEnum(CouponType)
  type: CouponType;

  @ApiProperty({ example: 25, description: 'Percentage (0-100), flat amount, or trial days' })
  @IsNumber()
  @Min(0)
  @Max(999)
  value: number;

  @ApiPropertyOptional({ example: 100, description: 'Max uses (null = unlimited)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiProperty({ example: '2024-01-01T00:00:00Z' })
  @IsDateString()
  validFrom: string;

  @ApiPropertyOptional({ example: '2024-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ example: 'Monthly', description: 'null = any plan' })
  @IsOptional()
  @IsString()
  plan?: string;
}

export class UpdateCouponDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  value?: number;
}

export class ValidateCouponDto {
  @ApiPropertyOptional({ description: 'Plan to validate against' })
  @IsOptional()
  @IsString()
  plan?: string;
}

export class RedeemCouponDto {
  @ApiProperty({ description: 'User ID to redeem for' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}
