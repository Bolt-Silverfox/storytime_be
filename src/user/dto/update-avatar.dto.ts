import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateAvatarDto {
  @ApiProperty({
    example: 'avatar-uuid',
    description: 'The ID of the avatar to assign to the parent',
  })
  @IsString()
  @IsNotEmpty()
  avatarId: string;
}
