import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsArray,
  IsUUID,
} from 'class-validator';

export class CategoryResponseDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Unique identifier for the category',
  })
  id: string;

  @ApiProperty({
    example: 'Adventure',
    description: 'Name of the category',
  })
  name: string;

  @ApiProperty({
    example: 'adventure',
    description: 'URL-friendly slug for the category',
  })
  slug: string;

  @ApiProperty({
    example: 'https://example.com/images/adventure.jpg',
    description: 'URL of the category image (includes default placeholder if not set)',
  })
  image: string;

  @ApiPropertyOptional({
    example: 'Exciting adventure stories for kids',
    description: 'Description of the category',
  })
  description?: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Timestamp when the category was created',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Timestamp when the category was last updated',
  })
  updatedAt: Date;
}

export class CreateCategoryDto {
  @ApiProperty({
    example: 'Adventure',
    description: 'Name of the category',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    example: 'https://example.com/images/adventure.jpg',
    description: 'URL of the category image',
  })
  @IsOptional()
  @IsUrl()
  image?: string;

  @ApiPropertyOptional({
    example: 'Exciting adventure stories for kids',
    description: 'Description of the category',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    description: 'Array of age group IDs this category is suitable for',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  ageGroupIds: string[];
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({
    example: 'Adventure Stories',
    description: 'Name of the category',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/images/adventure-new.jpg',
    description: 'URL of the category image',
  })
  @IsOptional()
  @IsUrl()
  image?: string;

  @ApiPropertyOptional({
    example: 'Updated description for adventure stories',
    description: 'Description of the category',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    description: 'Array of age group IDs this category is suitable for',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ageGroupIds?: string[];
}
