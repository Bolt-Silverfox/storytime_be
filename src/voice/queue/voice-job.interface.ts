import { VoiceType } from '@/voice/dto/voice.dto';

/**
 * Voice job status enum
 */
export enum VoiceJobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  SYNTHESIZING = 'synthesizing',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Voice synthesis job data structure
 * This is serialized and stored in Redis
 */
export interface VoiceJobData {
  /** Unique identifier for tracking */
  jobId: string;

  /** User ID for tracking and authorization */
  userId: string;

  /** Job type discriminator */
  type: 'synthesize-text' | 'synthesize-story';

  /** Text synthesis options (for type: 'synthesize-text') */
  textSynthesis?: {
    /** The text to synthesize */
    text: string;
    /** Voice type to use */
    voiceType?: VoiceType;
    /** Custom voice ID (UUID) if using custom voice */
    customVoiceId?: string;
  };

  /** Story synthesis options (for type: 'synthesize-story') */
  storySynthesis?: {
    /** Story ID to generate audio for */
    storyId: string;
    /** Voice type to use */
    voiceType?: VoiceType;
    /** Custom voice ID (UUID) if using custom voice */
    customVoiceId?: string;
    /** Whether to update the story record with the audio URL */
    updateStory?: boolean;
  };

  /** Metadata for tracking */
  metadata?: {
    clientIp?: string;
    userAgent?: string;
    requestedAt: Date;
    /** Estimated text length for progress calculation */
    textLength?: number;
  };
}

/**
 * Voice job result returned by processor
 */
export interface VoiceJobResult {
  success: boolean;
  audioUrl?: string;
  /** Duration of the generated audio in seconds */
  durationSeconds?: number;
  /** File size in bytes */
  fileSizeBytes?: number;
  error?: string;
  errorCode?: string;
  attemptsMade: number;
  processingTimeMs: number;
}

/**
 * Voice job priority levels
 */
export enum VoicePriority {
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
export interface VoiceJobStatusResponse {
  jobId: string;
  status: VoiceJobStatus;
  progress: number;
  progressMessage?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: {
    audioUrl: string;
    durationSeconds?: number;
  };
  error?: string;
  estimatedTimeRemaining?: number;
}

/**
 * Queue statistics
 */
export interface VoiceQueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}
