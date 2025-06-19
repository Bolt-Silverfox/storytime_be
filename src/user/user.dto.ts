import { ApiProperty } from '@nestjs/swagger';

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
