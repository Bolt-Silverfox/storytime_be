import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateFxRateDto {
  @ApiProperty({
    example: 'NGN',
    description:
      'ISO-4217 currency code, upper-case (3 letters). USD is the base currency (implicit rate 1) and is rejected.',
  })
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter upper-case ISO-4217 code',
  })
  currency: string;

  @ApiProperty({
    example: 0.00065,
    description:
      'USD per 1 unit of `currency` (e.g. 0.00065 means 1 NGN = 0.00065 USD). Must be > 0 (stored with 8 decimal places).',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.00000001)
  @Max(1000000000)
  rateToUsd: number;

  @ApiPropertyOptional({
    example: '2026-01-01T00:00:00.000Z',
    description:
      'When this rate starts applying (ISO-8601). Defaults to now. Transactions created at or after this instant (until the next rate) convert at it. Dates more than 1 day in the future are rejected.',
  })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

export class FxRateDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'NGN' }) currency: string;
  @ApiProperty({ example: 0.00065, description: 'USD per 1 unit of currency' })
  rateToUsd: number;
  @ApiProperty() effectiveFrom: Date;
  @ApiProperty({ example: 'manual' }) source: string;
  @ApiProperty({ nullable: true, type: String }) createdByAdminId:
    string | null;
  @ApiProperty() createdAt: Date;
}
