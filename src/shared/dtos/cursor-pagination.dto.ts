import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CursorPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Opaque cursor for pagination (omit for first page)',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page (default 10, max 100)',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CursorPaginationMetaDto {
  @ApiProperty({
    description: 'Cursor to fetch the next page (null if no more pages)',
    nullable: true,
    example: 'eyJpZCI6ImFiYzEyMyJ9',
  })
  nextCursor: string | null;

  @ApiProperty({
    description: 'Cursor to fetch the previous page (null if first page)',
    nullable: true,
  })
  previousCursor: string | null;

  @ApiProperty({ description: 'Whether there are more items after this page' })
  hasNextPage: boolean;

  @ApiProperty({
    description: 'Whether there are items before this page',
  })
  hasPreviousPage: boolean;

  @ApiProperty({ description: 'Page size used for this request', example: 10 })
  limit: number;
}

export class CursorPaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of items', isArray: true })
  data: T[];

  @ApiProperty({
    description: 'Cursor pagination metadata',
    type: CursorPaginationMetaDto,
  })
  pagination: CursorPaginationMetaDto;
}
