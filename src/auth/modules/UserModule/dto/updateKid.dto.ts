import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class updateKidDto {
  @ApiProperty({ example: 'eqiv989bqem' })
  @Optional()
  id: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @Optional()
  name: string;

  @ApiProperty({ example: 'https://example.com' })
  @Optional()
  avatarUrl?: string;
}
