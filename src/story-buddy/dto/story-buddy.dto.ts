import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
  IsString, 
  IsNotEmpty, 
  IsOptional, 
  IsBoolean, 
  IsInt,
  Min,
  Max,
  IsUUID
} from 'class-validator';

export class CreateStoryBuddyDto {
  @ApiProperty({
    description: 'Unique name for the buddy (e.g., "lumina", "zylo")',
    example: 'lumina',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Display name for the buddy',
    example: 'Lumina',
  })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({
    description: 'Type of buddy',
    example: 'robot',
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({
    description: 'Description of the buddy',
    example: 'A friendly robot companion who loves adventures',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Image URL for the buddy (full character image)',
    example: 'https://example.com/lumina.png',
  })
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @ApiPropertyOptional({
    description: 'Profile avatar URL for the buddy (small circular avatar shown in kid profile)',
    example: 'https://example.com/lumina-avatar.png',
  })
  @IsString()
  @IsOptional()
  profileAvatarUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether the buddy is active',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Theme color for the buddy UI',
    example: '#4CAF50',
  })
  @IsString()
  @IsOptional()
  themeColor?: string;

  @ApiPropertyOptional({
    description: 'Minimum age for this buddy',
    example: 3,
    minimum: 0,
    maximum: 18,
  })
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageGroupMin?: number;

  @ApiPropertyOptional({
    description: 'Maximum age for this buddy',
    example: 12,
    minimum: 0,
    maximum: 18,
  })
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageGroupMax?: number;
}

export class UpdateStoryBuddyDto {
  @ApiPropertyOptional({
    description: 'Display name for the buddy',
    example: 'Lumina the Robot',
  })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Type of buddy',
    example: 'robot',
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description: 'Description of the buddy',
    example: 'An updated friendly robot companion',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Image URL for the buddy',
    example: 'https://example.com/lumina-updated.png',
  })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Profile avatar URL for the buddy',
    example: 'https://example.com/lumina-avatar-updated.png',
  })
  @IsString()
  @IsOptional()
  profileAvatarUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether the buddy is active',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Theme color for the buddy UI',
    example: '#2196F3',
  })
  @IsString()
  @IsOptional()
  themeColor?: string;

  @ApiPropertyOptional({
    description: 'Minimum age for this buddy',
    example: 4,
  })
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageGroupMin?: number;

  @ApiPropertyOptional({
    description: 'Maximum age for this buddy',
    example: 10,
  })
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageGroupMax?: number;
}

export class SelectBuddyDto {
  @ApiProperty({
    description: 'Story Buddy ID to select',
    example: 'buddy-123-uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  buddyId: string;
}

export class GetBuddyMessageDto {
  @ApiProperty({
    description: 'Context for the buddy message',
    example: 'bedtime',
  })
  @IsString()
  @IsNotEmpty()
  context: string;

  @ApiPropertyOptional({
    description: 'Additional context ID (e.g., story ID, challenge ID)',
    example: 'story-123-uuid',
  })
  @IsUUID()
  @IsOptional()
  contextId?: string;

  @ApiPropertyOptional({
    description: 'Message from frontend for the buddy to use',
    example: 'Hello there! Ready for a story?',
  })
  @IsString()
  @IsOptional()
  message?: string;
}

export class StoryBuddyResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  type: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  imageUrl: string;

  @ApiPropertyOptional()
  profileAvatarUrl?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional()
  themeColor?: string;

  @ApiProperty()
  ageGroupMin: number;

  @ApiProperty()
  ageGroupMax: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}