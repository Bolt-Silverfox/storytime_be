import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class UpdateExcludedStoryTagsDto {
  @ApiProperty({
    description: 'Array of story tag IDs to exclude for this kid',
    example: [
      '839ae39a-2f1f-4d88-bfc6-20c7a5d0f8f5',
      'c5f17f0a-af11-4370-b47a-a45df9d073bf',
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  tagIds: string[];
}
