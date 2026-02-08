import { ApiProperty } from '@nestjs/swagger';
import { BadgePreviewDto } from './badge-response.dto';
import { StreakResponseDto } from './streak-response.dto';

export class ProgressStatsDto {
  @ApiProperty({ description: 'Number of stories completed' })
  storiesCompleted: number;

  @ApiProperty({ description: 'Number of challenges completed' })
  challengesCompleted: number;

  @ApiProperty({ description: 'Total reading time in minutes' })
  totalReadingTimeMins: number;
}

export class ProgressHomeResponseDto {
  @ApiProperty({ type: StreakResponseDto })
  streak: StreakResponseDto;

  @ApiProperty({ type: [BadgePreviewDto] })
  badgesPreview: BadgePreviewDto[];

  @ApiProperty({ type: ProgressStatsDto })
  progressStats: ProgressStatsDto;
}

export class ProgressOverviewResponseDto {
  @ApiProperty({ type: StreakResponseDto })
  streak: StreakResponseDto;

  @ApiProperty({ type: [BadgePreviewDto] })
  badgesPreview: BadgePreviewDto[];

  @ApiProperty()
  storiesCompleted: number;

  @ApiProperty()
  challengesCompleted: number;
}
