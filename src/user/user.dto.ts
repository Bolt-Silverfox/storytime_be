import { VoiceType } from '@/story/story.dto';
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
import { IsString } from 'class-validator';

export class SetKidPreferredVoiceDto {
  @ApiProperty({ description: 'Voice ID to set as preferred', example: 'MILO' })
  @IsString()
  voiceType: string;
}

export class KidVoiceDto {
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  preferredVoiceId: string;
  @ApiProperty()
  voiceType: VoiceType;
}
