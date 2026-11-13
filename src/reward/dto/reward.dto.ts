import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const REWARD_REDEMPTION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'completed',
] as const;

const toPoints = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}) => {
  const raw = obj[key];
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
  return Number.NaN;
};

export class CreateRewardDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  name: string;
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  description?: string;
  @Transform(toPoints)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  @ApiProperty()
  points: number;
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  imageUrl?: string;
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Kid ID to assign the reward to' })
  kidId: string;
}

export class UpdateRewardDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ required: false })
  name?: string;
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  description?: string;
  @ValidateIf((_, value) => value !== undefined)
  @Transform(toPoints)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  @ApiProperty({ required: false })
  points?: number;
  @IsOptional()
  @IsString()
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
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Reward ID to redeem' })
  rewardId: string;
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Kid ID who is redeeming the reward' })
  kidId: string;
}

export class UpdateRewardRedemptionStatusDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Redemption ID' })
  redemptionId: string;
  @IsIn(REWARD_REDEMPTION_STATUSES)
  @ApiProperty({
    description: "New status ('pending', 'approved', 'rejected', 'completed')",
    enum: REWARD_REDEMPTION_STATUSES,
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
