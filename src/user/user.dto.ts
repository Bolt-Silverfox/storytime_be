import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateUserDto {
  @ApiProperty({ example: 'Mr', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: 'John Doe', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', required: false })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}

export class SetKidPreferredVoiceDto {
  @ApiProperty({ description: 'Kid ID' })
  kidId: string;
  @ApiProperty({ description: 'Voice ID to set as preferred' })
  voiceId: string;
}

export class KidVoiceDto {
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  preferredVoiceId: string;
}
