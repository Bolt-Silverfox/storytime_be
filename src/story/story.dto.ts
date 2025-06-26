import { ApiProperty } from '@nestjs/swagger';

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
  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  language: string;

  @ApiProperty({ type: [String] })
  themeIds: string[];

  @ApiProperty({ type: [String] })
  categoryIds: string[];

  @ApiProperty({ required: false })
  coverImageUrl?: string;

  @ApiProperty({ required: false })
  audioUrl?: string;

  @ApiProperty({ required: false })
  isInteractive?: boolean;

  @ApiProperty({ required: false })
  ageMin?: number;

  @ApiProperty({ required: false })
  ageMax?: number;

  @ApiProperty({ type: [StoryImageDto], required: false })
  images?: StoryImageDto[];

  @ApiProperty({ type: [StoryBranchDto], required: false })
  branches?: StoryBranchDto[];
}

export class UpdateStoryDto {
  @ApiProperty({ required: false })
  title?: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false })
  language?: string;

  @ApiProperty({ type: [String], required: false })
  themeIds?: string[];

  @ApiProperty({ type: [String], required: false })
  categoryIds?: string[];

  @ApiProperty({ required: false })
  coverImageUrl?: string;

  @ApiProperty({ required: false })
  audioUrl?: string;

  @ApiProperty({ required: false })
  isInteractive?: boolean;

  @ApiProperty({ required: false })
  ageMin?: number;

  @ApiProperty({ required: false })
  ageMax?: number;

  @ApiProperty({ type: [StoryImageDto], required: false })
  images?: StoryImageDto[];

  @ApiProperty({ type: [StoryBranchDto], required: false })
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
  @ApiProperty({ required: false })
  image?: string;
  @ApiProperty({ required: false })
  description?: string;
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
