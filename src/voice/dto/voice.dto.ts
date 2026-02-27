import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum VoiceSourceType {
  UPLOADED = 'uploaded',
  ELEVENLABS = 'elevenlabs',
}

export class UploadVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Dad Voice' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class CreateElevenLabsVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Robot Voice' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'ElevenLabs Voice ID', example: 'abc123xyz' })
  @IsString()
  @IsNotEmpty()
  elevenLabsVoiceId: string;
}

export class SetPreferredVoiceDto {
  @ApiProperty({
    description: 'Voice ID to set as preferred',
    example: 'uuid-voice-id',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
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
  MILO = 'MILO',
  BELLA = 'BELLA',
  COSMO = 'COSMO',
  NIMBUS = 'NIMBUS',
  FANICE = 'FANICE',
  CHIP = 'CHIP',
  ROSIE = 'ROSIE',
  PIXIE = 'PIXIE',
}

/**
 * Maps old VoiceType enum values (ElevenLabs codenames) to new display-name values.
 * Used during transition so old mobile clients and cached data still resolve correctly.
 */
export const VOICE_TYPE_MIGRATION_MAP: Record<string, VoiceType> = {
  CHARLIE: VoiceType.MILO,
  JESSICA: VoiceType.BELLA,
  WILL: VoiceType.COSMO,
  LILY: VoiceType.NIMBUS,
  BILL: VoiceType.FANICE,
  LAURA: VoiceType.CHIP,
};

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

export class BatchStoryAudioDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Story ID to generate batch audio for',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  storyId: string;

  @ApiProperty({
    required: false,
    example: 'NIMBUS',
    description: 'Preferred voice ID (Enum value or UUID)',
    type: 'string',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  voiceId?: VoiceType | string;
}
