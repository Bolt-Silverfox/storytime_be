import { ApiProperty } from '@nestjs/swagger';

export class KidStreakDto {
  @ApiProperty()
  currentStreak: number;

  @ApiProperty()
  longestStreak: number;
}

