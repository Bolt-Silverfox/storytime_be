import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { DateUtil } from '../../shared/utils/date.util';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

class UserHistoryPaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description:
      "Restrict to one of the user's children (ignored ids that are not this user's kids yield an empty page)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  kidId?: string;
}

export class UserActivityQueryDto extends UserHistoryPaginationDto {
  @ApiPropertyOptional({
    description: 'Exact action name, e.g. "USER_LOGIN"',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description:
      'ISO date, inclusive upper bound (a date-only value covers that whole UTC day)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

export const READING_RANGES = [7, 30, 90, 120, 365, 'all'] as const;
export type ReadingRange = (typeof READING_RANGES)[number];

export class UserReadingQueryDto extends UserHistoryPaginationDto {
  @ApiPropertyOptional({
    enum: READING_RANGES,
    default: 'all',
    description: 'Days back from now (by lastAccessed), or "all"',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'all' || value === undefined ? value : Number(value),
  )
  @IsIn(READING_RANGES)
  range?: ReadingRange = 'all';

  @ApiPropertyOptional({
    description:
      'ISO date, inclusive lower bound on lastAccessed. Overrides `range` when present.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'ISO date, inclusive upper bound on lastAccessed (date-only covers the whole UTC day). Overrides `range` when present.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  endDate?: string;
}

function assertOrdered(start?: Date, end?: Date, label = 'from'): void {
  if (start && end && start.getTime() > end.getTime()) {
    throw new BadRequestException(
      label === 'from'
        ? '`from` must not be after `to`'
        : '`startDate` must not be after `endDate`',
    );
  }
}

/** Resolves the activity date filter; a date-only `to` covers the whole day. */
export function resolveActivityWindow(
  dto: Pick<UserActivityQueryDto, 'from' | 'to'>,
): { from?: Date; to?: Date } {
  const from = dto.from ? new Date(dto.from) : undefined;
  const to = dto.to ? DateUtil.toInclusiveUpperBound(dto.to) : undefined;
  assertOrdered(from, to, 'from');
  return { from, to };
}

/**
 * Resolves the reading window on `lastAccessed`. Explicit startDate/endDate
 * (either or both) take precedence over `range`; `range=all` is unbounded.
 */
export function resolveReadingWindow(
  dto: Pick<UserReadingQueryDto, 'range' | 'startDate' | 'endDate'>,
  now: Date = new Date(),
): { start?: Date; end?: Date } {
  if (dto.startDate || dto.endDate) {
    const start = dto.startDate ? new Date(dto.startDate) : undefined;
    const end = dto.endDate
      ? DateUtil.toInclusiveUpperBound(dto.endDate)
      : undefined;
    assertOrdered(start, end, 'startDate');
    return { start, end };
  }
  const range = dto.range ?? 'all';
  if (range === 'all') return { start: undefined, end: undefined };
  return {
    start: new Date(now.getTime() - range * ONE_DAY_MS),
    end: undefined,
  };
}
