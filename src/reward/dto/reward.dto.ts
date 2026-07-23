import { ApiProperty } from '@nestjs/swagger';

export class CreateRewardDto {
  @ApiProperty()
  name: string;
  @ApiProperty({ required: false })
  description?: string;
  @ApiProperty()
  points: number;
  @ApiProperty({ required: false })
  imageUrl?: string;
  @ApiProperty({ description: 'Kid ID to assign the reward to' })
  kidId: string;
}

export class UpdateRewardDto {
  @ApiProperty({ required: false })
  name?: string;
  @ApiProperty({ required: false })
  description?: string;
  @ApiProperty({ required: false })
  points?: number;
  @ApiProperty({ required: false })
  imageUrl?: string;
}

export class RewardDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ required: false })
  description?: string;
  @ApiProperty()
  points: number;
  @ApiProperty({ required: false })
  imageUrl?: string;
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  createdAt: Date;
  @ApiProperty()
  updatedAt: Date;
}

export class RedeemRewardDto {
  @ApiProperty({ description: 'Reward ID to redeem' })
  rewardId: string;
  @ApiProperty({ description: 'Kid ID who is redeeming the reward' })
  kidId: string;
}

export class UpdateRewardRedemptionStatusDto {
  @ApiProperty({ description: 'Redemption ID' })
  redemptionId: string;
  @ApiProperty({
    description: "New status ('pending', 'approved', 'rejected', 'completed')",
  })
  status: string;
}

export class RewardRedemptionDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  rewardId: string;
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  redeemedAt: Date;
  @ApiProperty()
  status: string;
}
