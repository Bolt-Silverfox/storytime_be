import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class StoryImageDto {
  @ApiProperty()
  url: string;
  @ApiProperty({ required: false })
  caption?: string;
}

export class StoryBranchDto {
  @ApiProperty()
  prompt: string;
  @ApiProperty()
  optionA: string;
  @ApiProperty()
  optionB: string;
  @ApiProperty({ required: false })
  nextA?: string;
  @ApiProperty({ required: false })
  nextB?: string;
}

export class CreateStoryDto {
  @ApiProperty({ example: 'The Adventure of Little Bear' })
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MinLength(3, { message: 'Title must be at least 3 characters' })
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title: string;

  @ApiProperty({ example: 'A heartwarming tale about a brave little bear...' })
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  description: string;

  @ApiProperty({ example: 'English' })
  @IsString()
  @IsNotEmpty({ message: 'Language is required' })
  language: string;

  @ApiPropertyOptional({ example: 'https://example.com/cover.jpg' })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/thumbnail.jpg' })
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/audio.mp3' })
  @IsString()
  @IsOptional()
  audioUrl?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsInt({ message: 'Reading length must be an integer' })
  @Min(1, { message: 'Reading length must be at least 1 minute' })
  @Max(120, { message: 'Reading length must not exceed 120 minutes' })
  @IsOptional()
  readingLength?: number;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isPremium?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isInteractive?: boolean;

  @ApiPropertyOptional({ example: 4 })
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageMin?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageMax?: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true, message: 'Each category ID must be a valid UUID' })
  @IsNotEmpty({ message: 'At least one category is required' })
  categoryIds: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true, message: 'Each theme ID must be a valid UUID' })
  @IsOptional()
  themeIds: string[];

  @ApiPropertyOptional()
  @IsOptional()
  images?: StoryImageDto[];

  @ApiPropertyOptional()
  @IsOptional()
  branches?: StoryBranchDto[];
}

export class UpdateStoryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'Title must be at least 3 characters' })
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  audioUrl?: string;

  @ApiPropertyOptional()
  @IsInt({ message: 'Reading length must be an integer' })
  @Min(1, { message: 'Reading length must be at least 1 minute' })
  @Max(120, { message: 'Reading length must not exceed 120 minutes' })
  @IsOptional()
  readingLength?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPremium?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isInteractive?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageMin?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  @IsOptional()
  ageMax?: number;

  @ApiPropertyOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  categoryIds?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  themeIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  images?: StoryImageDto[];

  @ApiPropertyOptional()
  @IsOptional()
  branches?: StoryBranchDto[];
}

export class FavoriteDto {
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  storyId: string;
}

export class StoryProgressDto {
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  storyId: string;
  @ApiProperty()
  progress: number;
  @ApiProperty({ required: false })
  completed?: boolean;
  @ApiProperty({
    required: false,
    description: 'Time spent in this specific session in seconds',
  })
  sessionTime?: number;
}

export class DailyChallengeDto {
  @ApiProperty()
  storyId: string;
  @ApiProperty()
  challengeDate: string;
  @ApiProperty()
  wordOfTheDay: string;
  @ApiProperty()
  meaning: string;
}

export class UploadVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Dad Voice' })
  name: string;
}

export class CreateElevenLabsVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Robot Voice' })
  name: string;
  @ApiProperty({ description: 'ElevenLabs Voice ID', example: 'abc123xyz' })
  elevenLabsVoiceId: string;
}

export class SetPreferredVoiceDto {
  @ApiProperty({
    description: 'Voice ID to set as preferred',
    example: 'uuid-voice-id',
  })
  @IsString()
  voiceId: string;
}

export class VoiceResponseDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ description: "'uploaded' or 'elevenlabs'" })
  type: string;
  @ApiProperty({ required: false })
  url?: string;
  @ApiProperty({ required: false })
  elevenLabsVoiceId?: string;
}

export class AssignDailyChallengeDto {
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  challengeId: string;
}

export class CompleteDailyChallengeDto {
  @ApiProperty()
  assignmentId: string;
}

export class DailyChallengeAssignmentDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  challengeId: string;
  @ApiProperty()
  completed: boolean;
  @ApiProperty({ required: false })
  completedAt?: Date;
  @ApiProperty()
  assignedAt: Date;
}

export class StartStoryPathDto {
  @ApiProperty({ description: 'Kid ID' })
  kidId: string;
  @ApiProperty({ description: 'Story ID' })
  storyId: string;
}

export class UpdateStoryPathDto {
  @ApiProperty({ description: 'StoryPath ID' })
  pathId: string;
  @ApiProperty({
    description: 'Updated path (JSON or delimited string of choices)',
  })
  path: string;
  @ApiProperty({ required: false, description: 'Mark as completed' })
  completedAt?: Date;
}

export class StoryPathDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  kidId: string;
  @ApiProperty()
  storyId: string;
  @ApiProperty()
  path: string;
  @ApiProperty()
  startedAt: Date;
  @ApiProperty({ required: false })
  completedAt?: Date;
}

export class CategoryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  image?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Number of stories in this category' })
  storyCount?: number;
}

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  iconUrl?: string;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  sortOrder?: number;
}

export class ThemeDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ required: false })
  image?: string;
  @ApiProperty({ required: false })
  description?: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 'Error message' })
  message: string;
  @ApiProperty({ example: 400, required: false })
  statusCode?: number;
  @ApiProperty({ required: false, description: 'Additional error details' })
  details?: any;
}

export class GenerateStoryDto {
  @ApiProperty({ type: [String], required: false })
  themes?: string[];

  @ApiProperty({ type: [String], required: false })
  categories?: string[];

  @ApiProperty({ required: false })
  kidId?: string;

  @ApiProperty({ required: false })
  kidName?: string;

  @ApiProperty({ required: false })
  ageMin?: number;

  @ApiProperty({ required: false })
  ageMax?: number;

  @ApiProperty({ required: false })
  language?: string;

  @ApiProperty({ required: false })
  additionalContext?: string;
}

export const VOICEID = {
  MILO: 'pNInz6obpgDQGcFmaJgB',
  BELLA: 'EXAVITQu4vr4xnSDxMaL',
  COSMO: 'TxGEqnHWrfWFTfGW9XjX',
  NIMBUS: '21m00Tcm4TlvDq8ikWAM',
  GRANDPA_JO: 'pqHfZKP75CvOlQylNhV4',
  CHIP: 'AZnzlk1XvdvUeBnXmlld',
};

export enum VoiceType {
  MILO = 'MILO',
  BELLA = 'BELLA',
  COSMO = 'COSMO',
  NIMBUS = 'NIMBUS',
  GRANDPA_JO = 'GRANDPA_JO',
  CHIP = 'CHIP',
}

export class StoryContentAudioDto {
  @ApiProperty()
  content: string;

  @ApiProperty({ required: false })
  voiceType?: VoiceType;
}

export class QuestionAnswerDto {
  @ApiProperty()
  kidId: string;

  @ApiProperty()
  questionId: string;

  @ApiProperty()
  storyId: string;

  @ApiProperty()
  selectedOption: number;
}

export class PaginationMetaDto {
  @ApiProperty({ description: 'Current page number', example: 1 })
  @IsNumber()
  currentPage: number;

  @ApiProperty({ description: 'Total number of pages', example: 5 })
  @IsNumber()
  totalPages: number;

  @ApiProperty({ description: 'Number of items per page', example: 12 })
  @IsNumber()
  pageSize: number;

  @ApiProperty({ description: 'Total number of items', example: 50 })
  @IsNumber()
  totalCount: number;
}

export class PaginatedStoriesDto {
  @ApiProperty({
    description: 'Array of stories',
    type: 'array',
    isArray: true,
  })
  @IsArray()
  data: any[];

  @ApiProperty({
    description: 'Pagination metadata',
    type: PaginationMetaDto,
  })
  pagination: PaginationMetaDto;
}
