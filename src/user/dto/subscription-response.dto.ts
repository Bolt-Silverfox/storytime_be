import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  plan: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  startedAt: Date;

  @ApiProperty({ required: false })
  endsAt?: Date | null;
}
