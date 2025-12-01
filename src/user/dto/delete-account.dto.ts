// delete-account.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({
    example: 'supersecretpassword',
    description: 'Current user password to confirm deletion',
    type: String, // Explicitly specify type
  })
  @IsString()
  password: string;

  @ApiProperty({
    type: [String],
    required: false,
    example: ['I do not like the app', 'Price too high'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true }) // Add this to ensure array elements are strings
  reasons?: string[];

  @ApiProperty({ 
    required: false, 
    example: 'Additional details',
    type: String // Explicitly specify type
  })
  @IsOptional()
  @IsString()
  notes?: string;
}