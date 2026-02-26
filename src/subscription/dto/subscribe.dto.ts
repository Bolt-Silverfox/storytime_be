import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class SubscribeDto {
  @ApiProperty({
    example: 'monthly',
    description: 'Plan key: free|weekly|monthly|yearly',
  })
  @IsString()
  plan: string;

  @ApiProperty({
    required: false,
    example: 'payment-method-uuid',
  })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @ApiProperty({
    required: false,
    example: '123456',
    description: '6-digit transaction PIN',
  })
  @IsOptional()
  @IsString()
  transactionPin?: string;

  @ApiProperty({
    required: false,
    example: true,
    description: 'Whether to attempt charging instantly',
  })
  @IsOptional()
  @IsBoolean()
  charge?: boolean;
}
