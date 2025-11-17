import { ApiProperty, PartialType } from '@nestjs/swagger';

// --- Story Images ---
export class StoryImageDto {
  @ApiProperty({ description: 'Image URL' })
  url: string;

  @ApiProperty({ description: 'Optional caption', required: false })
  caption?: string;
}

// --- Story Branches ---
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

// --- Create Story ---
export class CreateStoryDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  language: string;

  @ApiProperty({ type: [String], description: 'Theme IDs' })
  themes: string[];

  @ApiProperty({ type: [String], description: 'Category IDs' })
  categories: string[];

  @ApiProperty({ required: false })
  coverImageUrl?: string;

  @ApiProperty({ required: false })
  audioUrl?: string;

  @ApiProperty({ required: false, default: false })
  isInteractive?: boolean;

  @ApiProperty({ required: false, default: 0 })
  ageMin?: number;

  @ApiProperty({ required: false, default: 99 })
  ageMax?: number;

  @ApiProperty({ type: [StoryImageDto], required: false })
  images?: StoryImageDto[];

  @ApiProperty({ type: [StoryBranchDto], required: false })
  branches?: StoryBranchDto[];
}

// --- Update Story ---
export class UpdateStoryDto extends PartialType(CreateStoryDto) {}

// --- Favorites ---
export class FavoriteDto {
  @ApiProperty()
  storyId: string;
}

// --- Story Progress ---
export class StoryProgressDto {
  @ApiProperty()
  storyId: string;

  @ApiProperty({ description: 'Progress from 0 to 100' })
  progress: number;

  @ApiProperty({ required: false, default: false })
  completed?: boolean;
}

// --- Daily Challenges ---
export class DailyChallengeDto {
  @ApiProperty()
  storyId: string;

  @ApiProperty({ description: 'Date of challenge, ISO string' })
  challengeDate: string;

  @ApiProperty()
  wordOfTheDay: string;

  @ApiProperty()
  meaning: string;
}

// --- Upload Voice ---
export class UploadVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Dad Voice' })
  name: string;
}

// --- Eleven Labs Voice ---
export class CreateElevenLabsVoiceDto {
  @ApiProperty({ description: 'Voice name', example: 'Robot Voice' })
  name: string;

  @ApiProperty({ description: 'ElevenLabs Voice ID', example: 'abc123xyz' })
  elevenLabsVoiceId: string;
}

// --- Set Preferred Voice ---
export class SetPreferredVoiceDto {
  @ApiProperty({
    description: 'Voice ID to set as preferred',
    example: 'uuid-voice-id',
  })
  voiceId: string;
}

// --- Voice Response ---
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

// --- Daily Challenge Assignment ---
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

  @ApiProperty({ default: false })
  completed: boolean;

  @ApiProperty({ required: false })
  completedAt?: Date;

  @ApiProperty()
  assignedAt: Date;
}

// --- Story Path ---
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
    description: 'Updated path (JSON string or delimited choices)',
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
