import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentMethodDto {
  @ApiProperty({ example: 'card' })
  type: string;

  @ApiProperty({ example: 'Card description / token', required: true })
  details: string;  // <-- REQUIRED BECAUSE OF PRISMA

  @ApiProperty({ required: false, example: 'visa' })
  provider?: string;

  @ApiProperty({ required: false, example: '4242' })
  last4?: string;

  @ApiProperty({ required: false, example: '06/27' })
  expiry?: string;

  @ApiProperty({
    required: false,
    description: 'Optional provider metadata as JSON',
    example: { device: 'iPhone', token: 'abc123' },
  })
  meta?: any;
}
