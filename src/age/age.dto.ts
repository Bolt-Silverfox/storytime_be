import { PartialType, ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min, Max, IsNotEmpty } from 'class-validator';

export class CreateAgeDto {
  @ApiProperty({ example: 'Toddler', description: 'Name of the age group' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 1, description: 'Minimum age' })
  @IsInt()
  @Min(0)
  min: number;

  @ApiProperty({ example: 3, description: 'Maximum age' })
  @IsInt()
  @Min(1)
  max: number;
}

export class UpdateAgeDto extends PartialType(CreateAgeDto) {}
