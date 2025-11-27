import { ApiProperty } from '@nestjs/swagger';

export class ChargeSubscriptionDto {
  @ApiProperty({ example: 'pm_123456789' })
  paymentMethodId!: string; 

  @ApiProperty({ example: 'monthly' })
  plan!: string;

  @ApiProperty({ example: '123456' })
  transactionPin!: string;
}
