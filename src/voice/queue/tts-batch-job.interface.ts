export enum TtsBatchStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface TtsBatchJobData {
  batchJobId: string;
  storyId: string;
  voiceId: string;
  /** User id, or the guest session id when `isGuest` (ownership / SSE key). */
  userId: string;
  /**
   * Guest job: `userId` is a guest session id, NOT a User row. The processor
   * must not pass it to quota/usage code (UserUsage has a FK to User).
   */
  isGuest?: boolean;
  isPremium: boolean;
  provider: 'elevenlabs' | 'deepgram' | 'edgetts';
  paragraphs: Array<{
    index: number;
    text: string;
    hash: string;
    duplicateIndices?: number[];
  }>;
  totalParagraphs: number;
  /**
   * Self-heal round for this job. Absent/0 on the initial run; incremented on
   * each delayed follow-up that re-attempts paragraphs which exhausted the
   * whole provider chain. Bounded by MAX_RETRY_GENERATIONS.
   */
  retryGeneration?: number;
}

export interface TtsBatchJobResult {
  success: boolean;
  completedCount: number;
  failedCount: number;
  error?: string;
}

export interface TtsBatchStatusResponse {
  status: TtsBatchStatus;
  completedParagraphs: Array<{ index: number; audioUrl: string }>;
  failedParagraphs: number[];
  totalQueued: number;
  error?: string;
}
