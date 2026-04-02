import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
} from 'class-validator';

export type ReadStatus = 'done' | 'reading';

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

export class GuestStoryCategoryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false, nullable: true })
  description?: string | null;

  @ApiProperty({ required: false, nullable: true })
  image?: string | null;
}

export class GuestProgressResponseDto {
  @ApiProperty({ description: 'Story ID' })
  storyId: string;

  @ApiProperty({ description: 'Story title' })
  title: string;

  @ApiProperty({ description: 'Story description' })
  description: string;

  @ApiProperty({ description: 'Story cover image URL' })
  coverImageUrl: string;

  @ApiProperty({ description: 'Story age max' })
  ageMax: number;

  @ApiProperty({ description: 'Story age min' })
  ageMin: number;

  @ApiProperty({ description: 'Story duration in seconds', nullable: true })
  durationSeconds: number | null;

  @ApiProperty({ description: 'Story created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Story updated at' })
  updatedAt: Date;

  @ApiProperty({ description: 'Story categories', type: [GuestStoryCategoryDto] })
  categories: GuestStoryCategoryDto[];

  @ApiProperty({ description: 'Reading progress percentage' })
  progress: number;

  @ApiProperty({ description: 'Last accessed timestamp' })
  lastAccessed: Date;

  @ApiProperty({ description: 'Total time spent reading' })
  totalTimeSpent: number;

  @ApiProperty({ description: 'Read status: done, reading, or null', nullable: true, enum: ['done', 'reading'] })
  readStatus: ReadStatus | null;
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
  url: string;

  @ApiProperty({ required: false, nullable: true })
  caption?: string | null;
}

export class GuestStoryBranchDto {
  @ApiProperty()
  prompt: string;

  @ApiProperty()
  optionA: string;

  @ApiProperty()
  optionB: string;

  @ApiProperty({ required: false, nullable: true })
  nextA?: string | null;

  @ApiProperty({ required: false, nullable: true })
  nextB?: string | null;
}

export class GuestStoryThemeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false, nullable: true })
  description?: string | null;

  @ApiProperty({ required: false, nullable: true })
  image?: string | null;
}

export class GuestStoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  language: string;

  @ApiProperty({ type: [GuestStoryCategoryDto] })
  categories: GuestStoryCategoryDto[];

  @ApiProperty({ type: [GuestStoryThemeDto] })
  themes: GuestStoryThemeDto[];

  @ApiProperty({ type: [String], required: false })
  seasonIds?: string[];

  @ApiProperty({ required: false, nullable: true })
  coverImageUrl?: string | null;

  @ApiProperty({ required: false, nullable: true })
  audioUrl?: string | null;

  @ApiProperty({ required: false, nullable: true })
  textContent?: string | null;

  @ApiProperty({ required: false })
  isInteractive?: boolean;

  @ApiProperty({ required: false })
  ageMin?: number;

  @ApiProperty({ required: false })
  ageMax?: number;

  @ApiProperty({ type: [GuestStoryImageDto], required: false })
  images?: GuestStoryImageDto[];

  @ApiProperty({ type: [GuestStoryBranchDto], required: false })
  branches?: GuestStoryBranchDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class StoryAccessCheckDto {
  @ApiProperty({ description: 'Whether the story can be accessed' })
  canAccess: boolean;

  @ApiPropertyOptional({ description: 'Reason for denial if access is denied' })
  reason?: string;

  @ApiProperty({ description: 'Number of stories read in this session' })
  storiesRead: number;

  @ApiProperty({ description: 'Number stories remaining' })
  remaining: number;

  @ApiProperty({ description: 'Total stories allowed' })
  totalAllowed: number;

  @ApiProperty({ description: 'Whether this story has already been read' })
  alreadyRead: boolean;
}
