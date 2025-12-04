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

export const VOICEID = {
  MILO: 'pNInz6obpgDQGcFmaJgB',
  BELLA: 'EXAVITQu4vr4xnSDxMaL',
  COSMO: 'TxGEqnHWrfWFTfGW9XjX',
  NIMBUS: '21m00Tcm4TlvDq8ikWAM',
  GRANDPA_JO: 'pqHfZKP75CvOlQylNhV4',
  CHIP: 'AZnzlk1XvdvUeBnXmlld',
};

export enum VoiceType {
  MILO = 'MILO',
  BELLA = 'BELLA',
  COSMO = 'COSMO',
  NIMBUS = 'NIMBUS',
  GRANDPA_JO = 'GRANDPA_JO',
  CHIP = 'CHIP',
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
    required: false,
    example: 'MILO',
    description: 'Preferred voice to use for TTS',
    enum: VoiceType,
  })
  @IsOptional()
  @IsEnum(VoiceType)
  voiceType?: VoiceType;
}
