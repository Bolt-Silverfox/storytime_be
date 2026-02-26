import { ApiProperty } from '@nestjs/swagger';
import { ParentFavoriteResponseDto } from './parent-favorite-response.dto';
import { CursorPaginationMetaDto } from '@/shared/dtos/cursor-pagination.dto';

export class CursorPaginatedParentFavoritesDto {
  @ApiProperty({
    description: 'Array of parent favorites',
    type: [ParentFavoriteResponseDto],
  })
  data: ParentFavoriteResponseDto[];

  @ApiProperty({
    description: 'Cursor pagination metadata',
    type: CursorPaginationMetaDto,
  })
  pagination: CursorPaginationMetaDto;
}
