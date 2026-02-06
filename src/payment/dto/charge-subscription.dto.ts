import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  Length,
  Matches,
} from 'class-validator';

export class ChargeSubscriptionDto {
  @ApiProperty({
    example: 'pm_123456789',
    description: 'Payment method ID (required for paid plans)',
    required: false,
  })
  @IsString()
  @IsOptional()
  paymentMethodId?: string;

  @ApiProperty({
    example: 'monthly',
    description: 'Subscription plan',
    enum: ['free', 'weekly', 'monthly', 'yearly'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['free', 'weekly', 'monthly', 'yearly'])
  plan: string;

  @ApiProperty({
    example: '123456',
    description: 'Transaction PIN for verification (4-8 digits)',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Length(4, 8)
  @Matches(/^\d+$/, { message: 'Transaction PIN must contain only digits' })
  transactionPin?: string;
}
