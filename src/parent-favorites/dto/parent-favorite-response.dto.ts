import { ApiProperty } from '@nestjs/swagger';

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

    @ApiProperty({ description: 'Author of the story (if any)', required: false })
    author?: string;

    @ApiProperty({ description: 'Age range of the story (e.g. "3-5")', required: false })
    ageRange?: string;

    @ApiProperty({ description: 'Date the story was favorited' })
    createdAt: Date;
}
