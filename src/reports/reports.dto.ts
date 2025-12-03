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

// ============== CUSTOM DATE RANGE ==============
export class CustomDateRangeDto {
  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;
}

export class CustomRangeReportDto {
  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty()
  kidId: string;

  @ApiProperty()
  kidName: string;

  @ApiProperty()
  avatarUrl?: string;

  @ApiProperty()
  storiesCompleted: number;

  @ApiProperty()
  screenTimeMins: number;

  @ApiProperty()
  starsEarned: number;

  @ApiProperty()
  badgesEarned: number;

  @ApiProperty()
  rightAnswers: number;

  @ApiProperty()
  totalAnswers: number;

  @ApiProperty()
  accuracyPercentage: number;
}

// ============== DAILY BREAKDOWN ==============
export class DailyBreakdownDto {
  @ApiProperty()
  date: Date;

  @ApiProperty()
  dayOfWeek: string; // Mon, Tue, Wed, etc.

  @ApiProperty()
  screenTimeMins: number;

  @ApiProperty()
  storiesCompleted: number;

  @ApiProperty()
  quizzesTaken: number;

  @ApiProperty()
  accuracyPercentage: number;
}

export class WeeklyDailyBreakdownDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  kidName: string;

  @ApiProperty()
  weekStartDate: Date;

  @ApiProperty()
  weekEndDate: Date;

  @ApiProperty({ type: [DailyBreakdownDto] })
  dailyBreakdown: DailyBreakdownDto[];
}

// ============== ACTIVITY CATEGORIES ==============
export enum ActivityCategory {
  STORIES = 'stories',
  PLAY_TIME = 'play_time',
  READING = 'reading',
  CREATIVITY = 'creativity',
  OFF_THE_CUFF = 'off_the_cuff',
  QUIZ = 'quiz',
}

export class ActivityCategoryBreakdownDto {
  @ApiProperty({ enum: ActivityCategory })
  category: ActivityCategory;

  @ApiProperty()
  categoryLabel: string;

  @ApiProperty()
  timeMins: number;

  @ApiProperty()
  count: number;

  @ApiProperty()
  percentage: number;
}

export class KidActivityCategoriesDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  kidName: string;

  @ApiProperty()
  startDate: Date;

  @ApiProperty()
  endDate: Date;

  @ApiProperty({ type: [ActivityCategoryBreakdownDto] })
  categories: ActivityCategoryBreakdownDto[];

  @ApiProperty()
  totalTimeMins: number;
}

// ============== WEEK-OVER-WEEK COMPARISON ==============
export class WeekComparisonMetricsDto {
  @ApiProperty()
  currentWeekValue: number;

  @ApiProperty()
  previousWeekValue: number;

  @ApiProperty()
  change: number;

  @ApiProperty()
  changePercentage: number;

  @ApiProperty()
  isIncrease: boolean;
}

export class KidWeekComparisonDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  kidName: string;

  @ApiProperty()
  avatarUrl?: string;

  @ApiProperty()
  currentWeekStart: Date;

  @ApiProperty()
  currentWeekEnd: Date;

  @ApiProperty()
  screenTime: WeekComparisonMetricsDto;

  @ApiProperty()
  storiesCompleted: WeekComparisonMetricsDto;

  @ApiProperty()
  quizAccuracy: WeekComparisonMetricsDto;

  @ApiProperty()
  starsEarned: WeekComparisonMetricsDto;
}

// ============== QUIZ ACCURACY TRENDS ==============
export class QuizAccuracyTrendDto {
  @ApiProperty()
  date: Date;

  @ApiProperty()
  weekLabel: string; // e.g., "Nov 14-20"

  @ApiProperty()
  totalQuestions: number;

  @ApiProperty()
  correctAnswers: number;

  @ApiProperty()
  accuracyPercentage: number;
}

export class KidQuizTrendsDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  kidName: string;

  @ApiProperty({ type: [QuizAccuracyTrendDto] })
  weeklyTrends: QuizAccuracyTrendDto[];

  @ApiProperty()
  overallAccuracy: number;

  @ApiProperty()
  totalQuestions: number;

  @ApiProperty()
  totalCorrect: number;
}
