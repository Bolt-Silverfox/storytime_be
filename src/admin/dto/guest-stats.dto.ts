import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class TrendValueDto {
  @ApiProperty() value: number;
  @ApiProperty() trend: number;
  @ApiProperty() direction: 'up' | 'down' | 'neutral';
}

export class GuestStatsDto {
  @ApiProperty() totalSessions: number;
  @ApiProperty({ type: TrendValueDto }) sessionsThisMonth: TrendValueDto;
  @ApiProperty() totalStoriesRead: number;
  @ApiProperty({ type: TrendValueDto }) storiesReadThisMonth: TrendValueDto;
  @ApiProperty() quotaExhausted: number;
  @ApiProperty({ type: TrendValueDto }) quotaExhaustedThisMonth: TrendValueDto;
  @ApiProperty() uniqueStoriesAccessed: number;
}

export class GuestActivityFilterDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) limit?: number = 10;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
}
