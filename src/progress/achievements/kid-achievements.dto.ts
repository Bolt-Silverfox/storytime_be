import { ApiProperty } from '@nestjs/swagger';

export class KidBadgeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description?: string;

  @ApiProperty()
  unlockedAt: Date;
}

export class KidAchievementsListDto {
  @ApiProperty({ type: [KidBadgeDto] })
  badges: KidBadgeDto[];

  @ApiProperty()
  total: number;
}
