import { IsString, IsBoolean, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAvatarDto {
  @ApiProperty({ example: 'Avatar Name', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', required: false })
  @IsString()
  @IsOptional()
  url?: string;

}

export class UpdateAvatarDto {
  @ApiProperty({ example: 'Avatar Name', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', required: false })
  @IsString()
  @IsOptional()
  url?: string;
}
export class AssignAvatarDto {
  @ApiProperty({ example: 'avatar-id' })
  @IsString()
  @IsNotEmpty()
  avatarId: string;

  @ApiProperty({ example: 'user-id', required: false })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiProperty({ example: 'kid-id', required: false })
  @IsString()
  @IsOptional()
  kidId?: string;
}