import { ApiProperty } from '@nestjs/swagger';

export class UpdateAvatarDto {
  @ApiProperty({
    example: 'avatar-uuid',
    description: 'The ID of the avatar to assign to the parent',
  })
  avatarId: string;
}
