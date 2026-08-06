import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateParentFavoriteDto {
  @ApiProperty({
    description: 'ID of the story to favorite',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
  })
  @IsString()
  @IsNotEmpty()
  storyId: string;
}
