import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  IsOptional,
  IsBoolean,
  IsArray,
  IsDate,
} from 'class-validator';

export class UpdateGuestProgressDto {
  @ApiProperty({ description: 'Story ID' })
  @IsString()
  @IsNotEmpty()
  storyId: string;

  @ApiProperty({ description: 'Reading progress percentage (0-100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  progress: number;
}

export class CreateGuestSessionResponseDto {
  @ApiProperty({ description: 'Guest session ID (UUID)' })
  sessionId: string;

  @ApiProperty({ description: 'Session creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Session TTL in seconds' })
  expiresIn: number;
}

export class GuestProgressResponseDto {
  @ApiProperty({ description: 'Story ID' })
  storyId: string;

  @ApiProperty({ description: 'Reading progress percentage' })
  progress: number;

  @ApiProperty({ description: 'Last accessed timestamp' })
  lastAccessed: Date;
}

export class GuestHistoryResponseDto {
  @ApiProperty({
    description: 'List of stories with reading progress',
    type: [GuestProgressResponseDto],
  })
  stories: GuestProgressResponseDto[];
}

export class GuestStoryImageDto {
  @ApiProperty()
  @IsString()
  url: string;

  @ApiProperty({ required: false })
  @IsOptional()
  caption?: string | null;
}

export class GuestStoryBranchDto {
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
  nextA?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  nextB?: string | null;
}

export class GuestStoryCategoryDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  description?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  image?: string | null;
}

export class GuestStoryThemeDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  description?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  image?: string | null;
}

export class GuestStoryResponseDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty()
  @IsString()
  language: string;

  @ApiProperty({ type: [GuestStoryCategoryDto] })
  @IsArray()
  categories: GuestStoryCategoryDto[];

  @ApiProperty({ type: [GuestStoryThemeDto] })
  @IsArray()
  themes: GuestStoryThemeDto[];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seasonIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  coverImageUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  audioUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  textContent?: string | null;

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

 @ApiProperty({ type: [GuestStoryImageDto], required: false })
  @IsOptional()
  @IsArray()
  images?: GuestStoryImageDto[];

  @ApiProperty({ type: [GuestStoryBranchDto], required: false })
  @IsOptional()
  @IsArray()
  branches?: GuestStoryBranchDto[];

  @ApiProperty()
  @IsDate()
  createdAt: Date;

  @ApiProperty()
  @IsDate()
  updatedAt: Date;
}

export class StoryAccessCheckDto {
  @ApiProperty({ description: 'Whether the story can be accessed' })
  @IsBoolean()
  canAccess: boolean;

  @ApiPropertyOptional({ description: 'Reason for denial if access is denied' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ description: 'Number of stories read in this session' })
  @IsNumber()
  storiesRead: number;

  @ApiProperty({ description: 'Number stories remaining' })
  @IsNumber()
  remaining: number;

  @ApiProperty({ description: 'Total stories allowed' })
  @IsNumber()
  totalAllowed: number;

  @ApiProperty({ description: 'Whether this story has already been read' })
  @IsBoolean()
  alreadyRead: boolean;
}
