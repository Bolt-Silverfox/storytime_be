// src/parent-favorites/dto/parent-favorite.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ParentFavoriteDto {
  @ApiProperty({ description: 'ID of the favorite entry' })
  id: string;

  @ApiProperty({ description: 'ID of the parent user' })
  parentId: string;

  @ApiProperty({ description: 'ID of the favorite story' })
  storyId: string;

  @ApiProperty({ description: 'Date the story was favorited' })
  createdAt: Date;
}
