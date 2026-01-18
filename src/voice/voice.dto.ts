import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @ApiProperty({ description: "'uploaded' or 'elevenlabs'", enum: VoiceSourceType })
  type: string;

  @ApiProperty({ required: false })
  previewUrl?: string; // Was previously 'url'

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
  GRANDPA_JO = 'GRANDPA_JO',
  CHIP = 'CHIP',
}

export const VOICE_CONFIG = {
  [VoiceType.MILO]: {
    id: VoiceType.MILO,
    name: 'Milo',
    model: 'aura-orion-en',
    gender: 'Male',
    elevenLabsId: 'pNInz6obpgDQGcFmaJgB', // Adam
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/4d05092a-3e4b-4b13-8d00-349f2b5a0378.mp3',
    voiceAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Milo',
  },
  [VoiceType.BELLA]: {
    id: VoiceType.BELLA,
    name: 'Bella',
    model: 'aura-asteria-en',
    gender: 'Female',
    elevenLabsId: '21m00Tcm4TlvDq8ikWAM', // Rachel
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/21m00Tcm4TlvDq8ikWAM/6504a520-20f4-41d9-813f-f952c42ab82a.mp3',
    voiceAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bella',
  },
  [VoiceType.COSMO]: {
    id: VoiceType.COSMO,
    name: 'Cosmo',
    model: 'aura-arcas-en',
    gender: 'Male',
    elevenLabsId: 'ErXwobaYiN019PkySvjV', // Antoni
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/ErXwobaYiN019PkySvjV/d9213123-cb20-424a-b51c-6581b2eb5912.mp3',
    voiceAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Cosmo',
  },
  [VoiceType.NIMBUS]: {
    id: VoiceType.NIMBUS,
    name: 'Nimbus',
    model: 'aura-luna-en',
    gender: 'Female',
    elevenLabsId: 'MF3mGyEYCl7XYWbV9V6O', // Elli
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/MF3mGyEYCl7XYWbV9V6O/d9ff6042-3765-4d76-bb50-138fa099b2c3.mp3',
    voiceAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Nimbus',
  },
  [VoiceType.GRANDPA_JO]: {
    id: VoiceType.GRANDPA_JO,
    name: 'Grandpa Jo',
    model: 'aura-angus-en',
    gender: 'Male',
    elevenLabsId: 'yoZ06aMxZJJ28mfd3POQ', // Sam
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/yoZ06aMxZJJ28mfd3POQ/1c4d417c-45dd-430b-980b-465451cb0d43.mp3',
    voiceAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=GrandpaJo',
  },
  [VoiceType.CHIP]: {
    id: VoiceType.CHIP,
    name: 'Chip',
    model: 'aura-perseus-en',
    gender: 'Male',
    elevenLabsId: 'TxGEqnHWrfWFTfGW9XjX', // Josh
    previewUrl: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/TxGEqnHWrfWFTfGW9XjX/3e0b379d-640a-48d1-8888-2178ee770178.mp3',
    voiceAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Chip',
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
