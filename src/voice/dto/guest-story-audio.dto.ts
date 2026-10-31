import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GuestStoryAudioDto {
  @ApiPropertyOptional({
    description:
      'Accepted for client compatibility but IGNORED: guests always get the ' +
      'default voice, enforced server-side.',
    example: 'NIMBUS',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  voiceId?: string;
}
