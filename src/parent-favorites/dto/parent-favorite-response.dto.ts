import { ApiProperty } from '@nestjs/swagger';
import { CategoryDto } from '@/story/dto/story.dto';

export class ParentFavoriteResponseDto {
  @ApiProperty({ description: 'ID of the favorite entry' })
  id: string;

  @ApiProperty({ description: 'ID of the story' })
  storyId: string;

  @ApiProperty({ description: 'Title of the story' })
  title: string;

  @ApiProperty({ description: 'Description of the story' })
  description: string;

  @ApiProperty({ description: 'Cover image URL of the story' })
  coverImageUrl: string;

  @ApiProperty({
    description: 'Categories of the story',
    type: [CategoryDto],
  })
  categories: CategoryDto[];

  @ApiProperty({
    description: 'Age range of the story (e.g. "3-5")',
  })
  ageRange: string;

  @ApiProperty({
    description: 'Duration of the story in seconds',
    required: false,
  })
  durationSeconds?: number;

  @ApiProperty({ description: 'Date the story was favorited' })
  createdAt: Date;
}
