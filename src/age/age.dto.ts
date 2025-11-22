import { PartialType, ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min, Max } from 'class-validator';

export class CreateAgeDto {
  @ApiProperty({ description: 'Name of the age group' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Minimum age' })
  @IsInt()
  @Min(0)
  min: number;

  @ApiProperty({ description: 'Maximum age' })
  @IsInt()
  @Min(0)
  max: number;
}

export class UpdateAgeDto extends PartialType(CreateAgeDto) {}
