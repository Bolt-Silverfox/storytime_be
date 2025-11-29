import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SetKidPreferredVoiceDto {
  @ApiProperty({ example: 'MALE' })
  @IsString()
  voiceType: string;
}

export class KidVoiceDto {
  @ApiProperty({ example: 'MALE' })
  voiceType: string;

  @ApiProperty({ example: 'voice_1234' })
  voiceId: string;
}
