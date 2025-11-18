import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class updateProfileDto {
  @ApiProperty({ example: true })
  @Optional()
  explicitContent?: boolean;

  @ApiProperty({ example: 50 })
  @Optional()
  maxScreenTimeMins?: number;

  @ApiProperty({ example: 'english' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @Optional()
  language?: string;

  @ApiProperty({ example: 'nigeria' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @Optional()
  country?: string;
}
