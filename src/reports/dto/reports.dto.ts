import { ApiProperty } from '@nestjs/swagger';

export class KidOverviewStatsDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  kidName: string;

  @ApiProperty()
  avatarUrl?: string;

  @ApiProperty()
  rank?: number; // Number of stories completed

  @ApiProperty()
  storiesCompleted: number;

  @ApiProperty()
  screenTimeMins: number;

  @ApiProperty()
  starsEarned: number;

  @ApiProperty()
  badgesEarned: number;
}

export class KidDetailedReportDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  kidName: string;

  @ApiProperty()
  avatarUrl?: string;

  @ApiProperty()
  screenTimeMins: number;

  @ApiProperty({ nullable: true })
  screenTimeLimitMins: number | null;

  @ApiProperty()
  screenTimeRemainingMins?: number;

  @ApiProperty()
  storiesCompleted: number;

  @ApiProperty()
  storiesInProgress: number;

  @ApiProperty()
  rightAnswers: number;

  @ApiProperty()
  totalAnswers: number;

  @ApiProperty()
  accuracyPercentage: number;

  @ApiProperty()
  starsEarned: number;

  @ApiProperty()
  badgesEarned: number;

  @ApiProperty()
  favoritesCount: number;

  @ApiProperty()
  lastActiveAt?: Date;
}

export class WeeklyReportDto {
  @ApiProperty()
  weekStartDate: Date;

  @ApiProperty()
  weekEndDate: Date;

  @ApiProperty({ type: [KidOverviewStatsDto] })
  kids: KidOverviewStatsDto[];

  @ApiProperty()
  totalStoriesCompleted: number;

  @ApiProperty()
  totalScreenTimeMins: number;
}

export class DailyLimitDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  dailyLimitMins?: number;

  @ApiProperty()
  todayScreenTimeMins: number;

  @ApiProperty()
  remainingMins?: number;

  @ApiProperty()
  limitReached: boolean;
}

export class ScreenTimeSessionDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  sessionId?: string;
}

export class EndScreenTimeSessionDto {
  @ApiProperty()
  sessionId: string;
}

export class SetDailyLimitDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty({
    required: false,
    description: 'Limit in minutes, null for no limit',
  })
  limitMins?: number;
}
