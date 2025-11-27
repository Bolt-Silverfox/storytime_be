import { IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateKidThemeDto {
  @ApiProperty({ example: 'DARK', enum: ['LIGHT', 'DARK', 'FOREST', 'SPACE', 'PINK', 'PURPLE'] })
  @IsString()
  @IsIn(['LIGHT', 'DARK', 'FOREST', 'SPACE', 'PINK', 'PURPLE'])
  theme: string;
}

