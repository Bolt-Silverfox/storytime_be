import { IsString, IsNotEmpty } from 'class-validator';

export class CreateParentFavoriteDto {
  @IsString()
  @IsNotEmpty()
  storyId: string;
}
