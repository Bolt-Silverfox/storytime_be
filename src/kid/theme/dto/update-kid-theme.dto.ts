import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';

export class UpdateKidThemeDto {
  @ApiProperty({ example: 'pink', enum: ['pink', 'blue', 'purple', 'yellow'] })
  @IsString()
  @IsIn(['pink', 'blue', 'purple', 'yellow'])
  theme: string;
}
