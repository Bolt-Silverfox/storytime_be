import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';

export class ReadingAnalyticsRangeDto {
  @ApiPropertyOptional({ enum: [7, 30, 90, 120, 365], default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90, 120, 365])
  range?: 7 | 30 | 90 | 120 | 365 = 30;

  // Custom range (takes precedence over `range` when both are present).
  @ApiPropertyOptional({
    description:
      'ISO date string. Together with endDate, overrides `range` with an explicit window.',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'ISO date string. Together with startDate, overrides `range` with an explicit window.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

/**
 * Resolves a ReadingAnalyticsRangeDto into an absolute { start, end } window.
 * A custom startDate/endDate pair takes precedence over `range` when both
 * are present; otherwise falls back to now minus `range` days.
 */
export function resolveReadingAnalyticsWindow(dto: ReadingAnalyticsRangeDto): {
  start: Date;
  end: Date;
} {
  if (dto.startDate && dto.endDate) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('startDate must be before endDate');
    }
    return { start, end };
  }

  const end = new Date();
  const start = new Date(
    end.getTime() - (dto.range ?? 30) * 24 * 60 * 60 * 1000,
  );
  return { start, end };
}

export class TopStoryDto {
  @ApiProperty() storyId: string;
  @ApiProperty() title: string;
  @ApiProperty({
    nullable: true,
    description:
      'null when fewer than 5 distinct readers (privacy suppression)',
  })
  readerCount: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'null when fewer than 5 distinct readers (privacy suppression)',
  })
  completionRate: number | null;
}

export class TrendPointDto {
  @ApiProperty() date: string;
  @ApiProperty() distinctReaders: number;
  @ApiProperty() completions: number;
}

export class ReaderDto {
  @ApiProperty() readerId: string;
  @ApiProperty({ enum: ['kid', 'user'] }) readerType: 'kid' | 'user';
  @ApiProperty() displayName: string;
  @ApiProperty() lastAccessed: Date;
}

export class StoryDetailDto {
  @ApiProperty() storyId: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) readerCount: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'null when fewer than 5 distinct readers (privacy suppression)',
  })
  completionRate: number | null;
  @ApiProperty({
    nullable: true,
    description:
      'null when fewer than 5 distinct readers (privacy suppression)',
  })
  avgTimeSpentSeconds: number | null;
  @ApiProperty({ type: [TrendPointDto] }) trend: TrendPointDto[];
  @ApiProperty({ type: [ReaderDto] }) readers: ReaderDto[];
  @ApiProperty() readersSuppressed: boolean;
}
