export enum TtsBatchStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface TtsBatchJobData {
  batchJobId: string;
  storyId: string;
  voiceId: string;
  userId: string;
  isPremium: boolean;
  provider: 'elevenlabs' | 'deepgram' | 'edgetts';
  paragraphs: Array<{
    index: number;
    text: string;
    hash: string;
    duplicateIndices?: number[];
  }>;
  totalParagraphs: number;
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
