import { ApiProperty } from '@nestjs/swagger';

// ---------------- REWARD ----------------
export class CreateRewardDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ required: false, description: 'Reward description' })
  description?: string;

  @ApiProperty({ description: 'Points required to redeem the reward' })
  points: number;

  @ApiProperty({ required: false, description: 'Image URL of the reward' })
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

// ---------------- REWARD REDEMPTION ----------------
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
    enum: ['pending', 'approved', 'rejected', 'completed'],
  })
  status: 'pending' | 'approved' | 'rejected' | 'completed';
}

export class RewardRedemptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  rewardId: string;

  @ApiProperty()
  kidId: string;

  @ApiProperty({ description: 'Date when the reward was redeemed' })
  redeemedAt: Date;

  @ApiProperty({ description: 'Points redeemed for this reward' })
  pointsRedeemed: number;

  @ApiProperty({
    description:
      "Current status of redemption ('pending', 'approved', 'rejected', 'completed')",
    enum: ['pending', 'approved', 'rejected', 'completed'],
  })
  status: 'pending' | 'approved' | 'rejected' | 'completed';
}
