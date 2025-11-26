import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
  IsString, 
  IsNotEmpty, 
  IsOptional, 
  IsArray, 
  IsBoolean, 
  IsInt, 
  Min, 
  Max,
  IsUUID,
  IsEnum
} from 'class-validator';

export class CreateStoryBuddyDto {
  @ApiProperty({
    description: 'Unique name for the buddy (e.g., "lucious", "zjin")',
    example: 'lucious',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Display name for the buddy',
    example: 'Lucious',
  })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiPropertyOptional({
    description: 'Description of the buddy\'s personality',
    example: 'A friendly robot companion who loves adventures',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Type of buddy',
    example: 'robot',
    enum: ['robot', 'fairy', 'animal', 'dragon', 'alien', 'superhero'],
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({
    description: 'Image URL (optional if uploading file)',
    example: 'https://example.com/lucious.png',
  })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({
    description: 'Personality traits as JSON string',
    example: '{"tone": "friendly", "energy": "high", "style": "playful"}',
  })
  @IsString()
  @IsOptional()
  personality?: string;

  @ApiPropertyOptional({
    description: 'Default voice type for this buddy',
    example: 'child-friendly',
  })
  @IsString()
  @IsOptional()
  voiceType?: string;

  @ApiPropertyOptional({
    description: 'Array of greeting messages',
    example: ['Hello friend!', 'Ready for an adventure?', 'Let\'s read together!'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  greetingMessages?: string[];

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

  @ApiPropertyOptional({
    description: 'Whether the buddy is active',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateStoryBuddyDto {
  @ApiPropertyOptional({
    description: 'Display name for the buddy',
    example: 'Lucious the Robot',
  })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Description of the buddy\'s personality',
    example: 'An updated friendly robot companion',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Type of buddy',
    example: 'robot',
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description: 'Image URL (optional if uploading file)',
    example: 'https://example.com/lucious-updated.png',
  })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({
    description: 'Personality traits as JSON string',
    example: '{"tone": "cheerful", "energy": "medium"}',
  })
  @IsString()
  @IsOptional()
  personality?: string;

  @ApiPropertyOptional({
    description: 'Default voice type for this buddy',
    example: 'energetic',
  })
  @IsString()
  @IsOptional()
  voiceType?: string;

  @ApiPropertyOptional({
    description: 'Array of greeting messages',
    example: ['Hi there!', 'Let\'s go!'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  greetingMessages?: string[];

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

  @ApiPropertyOptional({
    description: 'Whether the buddy is active',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
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

export enum InteractionContext {
  GREETING = 'greeting',
  STORY_START = 'story_start',
  BEDTIME = 'bedtime',
  CHALLENGE = 'challenge',
  STORY_COMPLETE = 'story_complete',
  SCREEN_TIME_WARNING = 'screen_time_warning',
  BUDDY_SELECTED = 'buddy_selected',
}

export class GetBuddyMessageDto {
  @ApiProperty({
    description: 'Context for the buddy message',
    example: 'bedtime',
    enum: InteractionContext,
  })
  @IsEnum(InteractionContext)
  @IsNotEmpty()
  context: InteractionContext;

  @ApiPropertyOptional({
    description: 'Additional context ID (e.g., story ID, challenge ID)',
    example: 'story-123-uuid',
  })
  @IsUUID()
  @IsOptional()
  contextId?: string;
}