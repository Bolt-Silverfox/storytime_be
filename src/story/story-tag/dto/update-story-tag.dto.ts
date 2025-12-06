import { ApiProperty } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { CreateStoryTagDto } from './create-story-tag.dto';

export class UpdateStoryTagDto extends PartialType(CreateStoryTagDto) {
  @ApiProperty({
    description: 'New name for the story tag',
    example: 'Friendly Monsters',
    required: false,
  })
  name?: string;

  @ApiProperty({
    description: 'New slug for the tag',
    example: 'friendly-monsters',
    required: false,
  })
  slug?: string;
}
