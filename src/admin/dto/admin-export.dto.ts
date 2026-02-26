import { IsOptional, IsEnum, IsDateString } from 'class-validator';

export class ExportAnalyticsDto {
  @IsEnum(['users', 'revenue', 'subscriptions'])
  type: 'users' | 'revenue' | 'subscriptions';

  @IsOptional()
  @IsEnum(['csv', 'json'])
  format?: 'csv' | 'json' = 'csv';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
