import { ApiProperty } from '@nestjs/swagger';

export class WeeklyActivityDto {
  @ApiProperty()
  day: string; // 'S', 'M', 'T', 'W', 'T', 'F', 'S'

  @ApiProperty()
  date: string; // ISO date string

  @ApiProperty()
  isActive: boolean;
}

export class StreakResponseDto {
  @ApiProperty({ description: 'Current consecutive active days' })
  currentStreak: number;

  @ApiProperty({ type: [WeeklyActivityDto] })
  weeklyActivity: WeeklyActivityDto[];

  @ApiProperty({ description: 'Last active date (ISO string)' })
  lastActiveDate: string | null;
}
