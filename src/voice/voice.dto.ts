import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @ApiProperty({ description: "'uploaded' or 'elevenlabs'" })
  type: string;

  @ApiProperty({ required: false })
  url?: string;

  @ApiProperty({ required: false })
  elevenLabsVoiceId?: string;
}

export enum VoiceType {
  MILO = 'MILO',
  BELLA = 'BELLA',
  COSMO = 'COSMO',
  NIMBUS = 'NIMBUS',
  GRANDPA_JO = 'GRANDPA_JO',
  CHIP = 'CHIP',
}

export const VOICE_CONFIG = {
  [VoiceType.MILO]: {
    model: 'aura-orion-en',
    gender: 'Male',
    elevenLabsId: 'pNInz6obpgDQGcFmaJgB', // Adam
  },
  [VoiceType.BELLA]: {
    model: 'aura-asteria-en',
    gender: 'Female',
    elevenLabsId: '21m00Tcm4TlvDq8ikWAM', // Rachel
  },
  [VoiceType.COSMO]: {
    model: 'aura-arcas-en',
    gender: 'Male',
    elevenLabsId: 'ErXwobaYiN019PkySvjV', // Antoni
  },
  [VoiceType.NIMBUS]: {
    model: 'aura-luna-en',
    gender: 'Female',
    elevenLabsId: 'MF3mGyEYCl7XYWbV9V6O', // Elli
  },
  [VoiceType.GRANDPA_JO]: {
    model: 'aura-angus-en',
    gender: 'Male',
    elevenLabsId: 'yoZ06aMxZJJ28mfd3POQ', // Sam
  },
  [VoiceType.CHIP]: {
    model: 'aura-perseus-en',
    gender: 'Male',
    elevenLabsId: 'TxGEqnHWrfWFTfGW9XjX', // Josh
  },
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
    required: false,
    example: 'MILO',
    description: 'Preferred voice to use for TTS',
    enum: VoiceType,
  })
  @IsOptional()
  @IsEnum(VoiceType)
  voiceType?: VoiceType;
}
