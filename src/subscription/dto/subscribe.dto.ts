import { ApiProperty } from '@nestjs/swagger';

export class SubscribeDto {
  @ApiProperty({ example: 'monthly', description: 'Plan key: free|weekly|monthly|yearly' })
  plan: string;

  @ApiProperty({ required: false, example: 'payment-method-uuid' })
  paymentMethodId?: string;

  @ApiProperty({ required: false, example: '123456', description: 'transaction PIN (6 digits) if required by UX' })
  transactionPin?: string;

  @ApiProperty({ required: false, description: 'Set true to attempt server-side charge using PaymentService', example: true })
  charge?: boolean;
}
