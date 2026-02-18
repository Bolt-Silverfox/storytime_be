import { ApiProperty } from '@nestjs/swagger';

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'monthly', description: 'Plan identifier' })
  plan: string;

  @ApiProperty({
    required: false,
    example: 'active',
    description: 'Subscription status (active, cancelled)',
  })
  status?: string;

  @ApiProperty({
    required: false,
    example: '2025-12-31T00:00:00.000Z',
    description: 'Optional subscription end date',
  })
  endsAt?: string | null;
}
