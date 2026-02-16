import { IsOptional, IsEnum, IsString } from 'class-validator';

export class ExportAnalyticsDto {
  @IsEnum(['users', 'revenue', 'subscriptions'])
  type: 'users' | 'revenue' | 'subscriptions';

  @IsOptional()
  @IsEnum(['csv', 'json'])
  format?: 'csv' | 'json' = 'csv';

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
