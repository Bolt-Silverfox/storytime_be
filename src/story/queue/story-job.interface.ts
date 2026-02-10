import { VoiceType } from '@/voice/dto/voice.dto';

/**
 * Story job status enum
 */
export enum StoryJobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  GENERATING_CONTENT = 'generating_content',
  GENERATING_IMAGE = 'generating_image',
  GENERATING_AUDIO = 'generating_audio',
  PERSISTING = 'persisting',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Story generation job data structure
 * This is serialized and stored in Redis
 */
export interface StoryJobData {
  /** Unique identifier for tracking */
  jobId: string;

  /** User ID for tracking and authorization */
  userId: string;

  /** Job type discriminator */
  type: 'generate' | 'generate-for-kid';

  /** Generation options (for type: 'generate') */
  options?: {
    theme: string[];
    category: string[];
    seasonIds?: string[];
    ageMin: number;
    ageMax: number;
    kidName?: string;
    language?: string;
    additionalContext?: string;
    voiceType?: VoiceType;
  };

  /** Kid-specific generation (for type: 'generate-for-kid') */
  kidGeneration?: {
    kidId: string;
    themes?: string[];
    categories?: string[];
    seasonIds?: string[];
    kidName?: string;
  };

  /** Metadata for tracking */
  metadata?: {
    clientIp?: string;
    userAgent?: string;
    requestedAt: Date;
  };
}

/**
 * Story job result returned by processor
 */
export interface StoryJobResult {
  success: boolean;
  storyId?: string;
  story?: StoryResult;
  error?: string;
  errorCode?: string;
  attemptsMade: number;
  processingTimeMs: number;
}

/**
 * Story result structure (subset of Prisma Story with relations)
 */
export interface StoryResult {
  id: string;
  title: string;
  description: string;
  language: string;
  coverImageUrl: string;
  audioUrl: string;
  textContent: string | null;
  ageMin: number;
  ageMax: number;
  wordCount: number;
  durationSeconds: number | null;
  aiGenerated: boolean;
  createdAt: Date;
  categories: Array<{ id: string; name: string }>;
  themes: Array<{ id: string; name: string }>;
  seasons?: Array<{ id: string; name: string }>;
}

/**
 * Story job priority levels
 */
export enum StoryPriority {
  /** Premium/paid users */
  HIGH = 1,
  /** Standard users */
  NORMAL = 5,
  /** Free tier / rate-limited */
  LOW = 10,
}

/**
 * Job status response for client polling
 */
export interface StoryJobStatusResponse {
  jobId: string;
  status: StoryJobStatus;
  progress: number;
  progressMessage?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: StoryResult;
  error?: string;
  estimatedTimeRemaining?: number;
}
