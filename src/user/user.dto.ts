import { VoiceType } from '@/story/story.dto';
import { ApiProperty } from '@nestjs/swagger';
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
