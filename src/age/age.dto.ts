import { PartialType, ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class CreateAgeDto {
  @ApiProperty({
    example: 'Toddler',
    description: 'Name of the age group',
    required: true,
    type: String,
    minLength: 1,
    maxLength: 50,
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 2,
    description: 'Minimum age for this age group',
    required: true,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  min: number;

  @ApiProperty({
    example: 5,
    description: 'Maximum age for this age group',
    required: true,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  max: number;
}

export class UpdateAgeDto extends PartialType(CreateAgeDto) {
  @ApiProperty({
    example: 'Preschool',
    description: 'Name of the age group (optional for update)',
    required: false,
    type: String,
    minLength: 1,
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: 3,
    description: 'Minimum age for this age group (optional for update)',
    required: false,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  min?: number;

  @ApiProperty({
    example: 6,
    description: 'Maximum age for this age group (optional for update)',
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  max?: number;
}

export class AgeGroupResponseDto extends CreateAgeDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: '2023-01-01T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00.000Z' })
  updatedAt: Date;
}
