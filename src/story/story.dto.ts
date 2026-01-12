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
export { VoiceType } from '../voice/voice.dto';

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
  @IsString()
  textContent?: string;

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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoryImageDto)
  images?: StoryImageDto[];

  @ApiProperty({ type: [StoryBranchDto], required: false })
  @IsOptional()
  @IsArray()
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
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoryImageDto)
  images?: StoryImageDto[];

  @ApiProperty({ type: [StoryBranchDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoryBranchDto)
  branches?: StoryBranchDto[];
}

export class FavoriteDto {
  @ApiProperty()
  @IsUUID()
  kidId: string;

  @ApiProperty()
  @IsUUID()
  storyId: string;
}

export class StoryProgressDto {
  @ApiProperty()
  @IsUUID()
  kidId: string;

  @ApiProperty()
  @IsUUID()
  storyId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  progress: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}

export class DailyChallengeDto {
  @ApiProperty()
  @IsUUID()
  storyId: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  challengeDate: Date;

  @ApiProperty()
  @IsString()
  wordOfTheDay: string;

  @ApiProperty()
  @IsString()
  meaning: string;
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
  @ApiProperty()
  @IsString()
  kidId: string;

  @ApiProperty()
  @IsString()
  storyId: string;
}

export class UpdateStoryPathDto {
  @ApiProperty()
  @IsString()
  pathId: string;

  @ApiProperty()
  @IsString()
  path: string; // JSON string of choices

  @ApiProperty({ required: false })
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

  @ApiProperty({ required: false })
  image?: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false })
  storyCount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
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

export class SubmitQuestionAnswerDto {
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

export class DownloadedStoryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  kidId: string;

  @ApiProperty()
  storyId: string;

  @ApiProperty()
  downloadedAt: Date;
}

export class StoryDto extends CreateStoryDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ description: 'Estimated reading time in seconds' })
  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class StoryWithProgressDto extends StoryDto {
  @ApiProperty()
  @IsNumber()
  progress: number;

  @ApiProperty({ required: false })
  @IsOptional()
  totalTimeSpent?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  lastAccessed?: Date;
}

export class LibraryStatsDto {
  @ApiProperty()
  totalStoriesRead: number;

  @ApiProperty()
  completedStoriesCount: number;
}

// --- Parent Recommendation DTOs ---
export class ParentRecommendationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  kidId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  storyId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;
}

export class RecommendationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  kidId: string;

  @ApiProperty()
  storyId: string;

  @ApiProperty({ required: false })
  message?: string;

  @ApiProperty()
  recommendedAt: Date;

  @ApiProperty({ required: false })
  story?: CreateStoryDto;

  @ApiProperty({ required: false })
  user?: any;

  @ApiProperty({ required: false })
  kid?: any;
}

export class RecommendationsStatsDto {
  @ApiProperty()
  totalCount: number;
}

export class TopPickStoryDto extends StoryDto {
  @ApiProperty({ description: 'Number of times this story has been recommended by parents' })
  @IsNumber()
  recommendationCount: number;

  @ApiPropertyOptional({ description: 'Story themes' })
  @IsOptional()
  themes?: ThemeDto[];

  @ApiPropertyOptional({ description: 'Story categories' })
  @IsOptional()
  categories?: CategoryDto[];

  // images is inherited from StoryDto -> CreateStoryDto
}

export class QuestionAnswerDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  kidId: string;

  @ApiProperty()
  questionId: string;

  @ApiProperty()
  storyId: string;

  @ApiProperty()
  selectedOption: number;

  @ApiProperty()
  isCorrect: boolean;

  @ApiProperty()
  answeredAt: Date;
}

export class RestrictStoryDto {
  @ApiProperty()
  @IsUUID()
  kidId: string;

  @ApiProperty()
  @IsUUID()
  storyId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
