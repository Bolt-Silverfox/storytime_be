import { ApiProperty } from '@nestjs/swagger';
import { StoryDto } from '../../story/story.dto';

export class ParentFavoriteDto {
  @ApiProperty({ description: 'ID of the favorite entry' })
  id: string;

  @ApiProperty({ description: 'ID of the parent user' })
  parentId: string;

  @ApiProperty({ description: 'The full story object' })
  story: StoryDto;

  @ApiProperty({ description: 'Date the story was favorited' })
  createdAt: Date;
}
