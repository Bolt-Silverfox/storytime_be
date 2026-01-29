import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsArray, IsUUID } from 'class-validator';

export class UpdateParentProfileDto {
  @ApiProperty({ required: false, example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, example: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ required: false, example: 'Nigeria' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  biometricsEnabled?: boolean;

  @ApiProperty({ required: false, example: ['category-uuid-1', 'category-uuid-2'] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  preferredCategories?: string[];

  @ApiProperty({ required: false, example: ['expectation-uuid-1', 'expectation-uuid-2'] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  learningExpectationIds?: string[];
}
