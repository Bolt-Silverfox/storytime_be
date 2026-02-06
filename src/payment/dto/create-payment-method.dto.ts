import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { Prisma } from '@prisma/client';

export class CreatePaymentMethodDto {
  @ApiProperty({ example: 'card', description: 'Payment method type (card, bank, etc.)' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ example: 'Card description / token', required: true })
  @IsString()
  @IsNotEmpty()
  details: string;

  @ApiProperty({ required: false, example: 'visa', description: 'Payment provider name' })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiProperty({ required: false, example: '4242', description: 'Last 4 digits of card' })
  @IsString()
  @IsOptional()
  last4?: string;

  @ApiProperty({ required: false, example: '06/27', description: 'Card expiry date' })
  @IsString()
  @IsOptional()
  expiry?: string;

  @ApiProperty({
    required: false,
    description: 'Optional provider metadata as JSON',
    example: { device: 'iPhone', token: 'abc123' },
  })
  @IsObject()
  @IsOptional()
  meta?: Prisma.InputJsonObject;
}
