import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsBoolean } from 'class-validator';

export class UpdateKidProfileDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  ageRange?: string;

  @ApiProperty({ example: 'pink', required: false })
  @IsString()
  @IsOptional()
  theme?: string;

  @ApiProperty({ required: false })
  @IsArray()
  @IsOptional()
  preferredCategoryIds?: string[];

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  preferredVoiceId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  avatarId?: string;
}
