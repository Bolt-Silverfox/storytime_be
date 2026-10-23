import { IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class ReadingAnalyticsRangeDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  range?: 7 | 30 | 90 = 30;
}

export class TopStoryDto {
  @ApiProperty() storyId: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, description: 'null when fewer than 5 distinct readers (privacy suppression)' })
  readerCount: number | null;
  @ApiProperty() completionRate: number;
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
  @ApiProperty() completionRate: number;
  @ApiProperty() avgTimeSpentSeconds: number;
  @ApiProperty({ type: [TrendPointDto] }) trend: TrendPointDto[];
  @ApiProperty({ type: [ReaderDto] }) readers: ReaderDto[];
  @ApiProperty() readersSuppressed: boolean;
}
