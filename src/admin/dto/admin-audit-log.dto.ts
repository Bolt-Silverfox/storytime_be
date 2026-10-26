import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminAuditLogFilterDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by the acting admin user id' })
  @IsOptional()
  @IsString()
  adminId?: string;

  @ApiPropertyOptional({
    description: 'Filter by dot-namespaced action, e.g. "user.suspend"',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by target type, e.g. "User"' })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
