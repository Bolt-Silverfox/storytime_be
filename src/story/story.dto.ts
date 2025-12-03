import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
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
  ValidateNested,
} from 'class-validator';

export class StoryImageDto {
  @ApiProperty()
  @IsString()
  url: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  caption?: string;
}

export class StoryBranchDto {
  @ApiProperty()
  @IsString()
  prompt: string;

  @ApiProperty()
  @IsString()
  optionA: string;

  @ApiProperty()
  @IsString()
  optionB: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nextA?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nextB?: string;
}

export class CreateStoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  language: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  themeIds: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  categoryIds: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  audioUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isInteractive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  ageMin?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  ageMax?: number;

  @ApiProperty({ type: [StoryImageDto], required: false })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StoryImageDto)
  images?: StoryImageDto[];

  @ApiProperty({ type: [StoryBranchDto], required: false })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StoryBranchDto)
  branches?: StoryBranchDto[];
}

export class UpdateStoryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  themeIds?: string[];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  audioUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isInteractive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  ageMin?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  ageMax?: number;

  @ApiProperty({ type: [StoryImageDto], required: false })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StoryImageDto)
  images?: StoryImageDto[];

  @ApiProperty({ type: [StoryBranchDto], required: false })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StoryBranchDto)
  branches?: StoryBranchDto[];
}

export class FavoriteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  kidId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  storyId: string;
}

export class StoryProgressDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  kidId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  storyId: string;

  @ApiProperty()
  @IsNumber()
  progress: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @ApiProperty({
    required: false,
    description: 'Time spent in this specific session in seconds',
  })
  @IsOptional()
  @IsNumber()
  sessionTime?: number;
}

export class DailyChallengeDto {
  @ApiProperty()
  @IsString()
  storyId: string;

  @ApiProperty()
  @IsString()
  challengeDate: string;

  @ApiProperty()
  @IsString()
  wordOfTheDay: string;

  @ApiProperty()
  @IsString()
  meaning: string;
}

export class UploadVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Dad Voice' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateElevenLabsVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Robot Voice' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'ElevenLabs Voice ID', example: 'abc123xyz' })
  @IsString()
  @IsNotEmpty()
  elevenLabsVoiceId: string;
}

export class SetPreferredVoiceDto {
  @ApiProperty({
    description: 'Voice ID to set as preferred',
    example: 'uuid-voice-id',
  })
  @IsString()
  @IsNotEmpty()
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
  @IsString()
  kidId: string;

  @ApiProperty()
  @IsString()
  challengeId: string;
}

export class CompleteDailyChallengeDto {
  @ApiProperty()
  @IsString()
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
  @IsString()
  kidId: string;

  @ApiProperty({ description: 'Story ID' })
  @IsString()
  storyId: string;
}

export class UpdateStoryPathDto {
  @ApiProperty({ description: 'StoryPath ID' })
  @IsString()
  pathId: string;

  @ApiProperty({
    description: 'Updated path (JSON or delimited string of choices)',
  })
  @IsString()
  path: string;

  @ApiProperty({ required: false, description: 'Mark as completed' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
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

// --- THIS WAS THE MISSING PART ---
export class GenerateStoryDto {
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  themes?: string[];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  kidId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  kidName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  ageMin?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  ageMax?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
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
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEnum(VoiceType)
  voiceType?: VoiceType;
}

export class QuestionAnswerDto {
  @ApiProperty()
  @IsString()
  kidId: string;

  @ApiProperty()
  @IsString()
  questionId: string;

  @ApiProperty()
  @IsString()
  storyId: string;

  @ApiProperty()
  @IsInt()
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
