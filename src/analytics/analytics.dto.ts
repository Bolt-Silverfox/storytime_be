import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsStatsDto {
  @ApiProperty()
  userCount: number;
  @ApiProperty()
  storyCount: number;
  @ApiProperty()
  kidCount: number;
  @ApiProperty()
  rewardCount: number;
}

export class CreateActivityLogDto {
  @ApiProperty({
    required: false,
    description: 'User ID (optional, for user-level activity)',
  })
  userId?: string;
  @ApiProperty({
    required: false,
    description: 'Kid ID (optional, for kid-level activity)',
  })
  kidId?: string;
  @ApiProperty({
    description: 'Action performed (e.g. story_read, reward_redeemed)',
  })
  action: string;
  @ApiProperty({
    required: false,
    description: 'Additional details (optional)',
  })
  details?: string;
}

export class ActivityLogDto {
  @ApiProperty()
  id: string;
  @ApiProperty({ required: false })
  userId?: string;
  @ApiProperty({ required: false })
  kidId?: string;
  @ApiProperty()
  action: string;
  @ApiProperty({ required: false })
  details?: string;
  @ApiProperty()
  createdAt: Date;
}
