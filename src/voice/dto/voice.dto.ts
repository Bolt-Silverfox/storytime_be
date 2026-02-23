import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export enum VoiceSourceType {
  UPLOADED = 'uploaded',
  ELEVENLABS = 'elevenlabs',
}

export class UploadVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Dad Voice' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateElevenLabsVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Robot Voice' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'ElevenLabs Voice ID', example: 'abc123xyz' })
  @IsOptional()
  @IsString()
  elevenLabsVoiceId: string;
}

export class SetPreferredVoiceDto {
  @ApiProperty({
    description: 'Voice ID to set as preferred',
    example: 'uuid-voice-id',
  })
  @IsString()
  voiceId: string;
}

export class VoiceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'User-facing display name' })
  displayName: string;

  @ApiProperty({
    description: "'uploaded' or 'elevenlabs'",
    enum: VoiceSourceType,
  })
  type: string;

  @ApiProperty({ required: false })
  previewUrl?: string;

  @ApiProperty({ required: false })
  voiceAvatar?: string;

  @ApiProperty({ required: false })
  elevenLabsVoiceId?: string;
}

export enum VoiceType {
  CHARLIE = 'CHARLIE',
  JESSICA = 'JESSICA',
  WILL = 'WILL',
  LILY = 'LILY',
  BILL = 'BILL',
  LAURA = 'LAURA',
  ROSIE = 'ROSIE',
  PIXIE = 'PIXIE',
}

export class StoryContentAudioDto {
  @ApiProperty({
    example: 'Once upon a time, in a far away land...',
    description: 'Raw story text that will be converted to audio',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Story ID for caching paragraph audio',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  storyId: string;

  @ApiProperty({
    required: false,
    example: 'MILO',
    description: 'Preferred voice ID (Enum value or UUID)',
    type: 'string',
  })
  @IsOptional()
  voiceId?: VoiceType | string;
}

export class AsyncStorySynthesisDto {
  @ApiProperty({
    example: 'story-uuid-123',
    description: 'Story ID to generate audio for',
  })
  @IsString()
  @IsNotEmpty()
  storyId: string;

  @ApiProperty({
    required: false,
    example: 'CHARLIE',
    description: 'Voice type (Enum value or custom voice UUID)',
    type: 'string',
  })
  @IsOptional()
  voiceId?: VoiceType | string;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Whether to update the story record with the new audio URL',
  })
  @IsOptional()
  @IsBoolean()
  updateStory?: boolean;
}
