import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionStatusResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  plan: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  endsAt: Date | null;

  @ApiPropertyOptional()
  platform: string | null;

  @ApiProperty({ description: 'Amount paid', example: 4.99 })
  price: number;

  @ApiProperty({ description: 'Currency code', example: 'USD' })
  currency: string;
}
