import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { MetricWithTrendDto } from './admin-responses.dto';

export class GuestStatsDto {
  @ApiProperty() totalSessions: number;
  @ApiProperty({ type: MetricWithTrendDto })
  sessionsThisMonth: MetricWithTrendDto;
  @ApiProperty() totalStoriesRead: number;
  @ApiProperty({ type: MetricWithTrendDto })
  storiesReadThisMonth: MetricWithTrendDto;
  @ApiProperty() quotaExhausted: number;
  @ApiProperty({ type: MetricWithTrendDto })
  quotaExhaustedThisMonth: MetricWithTrendDto;
  @ApiProperty() uniqueStoriesAccessed: number;
}

export class GuestActivityFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 10;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
}
