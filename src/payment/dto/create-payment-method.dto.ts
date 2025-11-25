import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentMethodDto {
  @ApiProperty({ example: 'card' })
  type: string;

  @ApiProperty({ required: false, example: 'visa' })
  provider?: string;

  @ApiProperty({ required: false, example: '4242' })
  last4?: string;

  @ApiProperty({ required: false, example: '06/27' })
  expiry?: string;

  @ApiProperty({ required: false, description: 'optional provider token', example: '{}' })
  meta?: any;
}
