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

  @ApiProperty({ example: 'en', required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ example: 'Nigeria', required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsString()
  numberOfKids?: number;

  @ApiProperty({ example: 'https://example.com/avatar.jpg', required: false })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @ApiProperty({ example: 'avatar-id', required: false })
  @IsOptional()
  @IsString()
  avatarId?: string;
}

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