import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoryJobStatus } from '../queue/story-job.interface';

/**
 * Response returned when a story generation job is enqueued.
 * Documents the shape of {@link QueuedStoryResult}.
 */
export class EnqueueStoryJobResponseDto {
  @ApiProperty({
    description: 'Whether the job was successfully accepted onto the queue',
  })
  queued: boolean;

  @ApiProperty({ description: 'Identifier used to poll status / fetch result' })
  jobId: string;

  @ApiPropertyOptional({
    description: 'Rough estimated wait time in seconds before processing',
  })
  estimatedWaitTime?: number;

  @ApiPropertyOptional({ description: 'Error message when queued is false' })
  error?: string;
}

/**
 * Response returned when polling the status of a story generation job.
 * Documents the shape of {@link StoryJobStatusResponse}.
 */
export class StoryJobStatusResponseDto {
  @ApiProperty({ description: 'Job identifier' })
  jobId: string;

  @ApiProperty({ enum: StoryJobStatus, description: 'Current job state' })
  status: StoryJobStatus;

  @ApiProperty({ description: 'Progress percentage (0-100)' })
  progress: number;

  @ApiPropertyOptional({ description: 'Human-readable progress description' })
  progressMessage?: string;

  @ApiProperty({ description: 'When the job was created' })
  createdAt: Date;

  @ApiPropertyOptional({ description: 'When processing started' })
  startedAt?: Date;

  @ApiPropertyOptional({ description: 'When processing finished' })
  completedAt?: Date;

  @ApiPropertyOptional({
    description: 'Generated story payload (present once completed)',
    type: Object,
  })
  result?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Failure reason when status is failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Estimated seconds remaining' })
  estimatedTimeRemaining?: number;
}

/**
 * Response returned when fetching the result of a job that is not yet complete.
 */
export class StoryJobResultPendingDto {
  @ApiProperty({ description: 'Job identifier' })
  jobId: string;

  @ApiProperty({
    description: 'Set to false while the story is still being generated',
    example: false,
  })
  ready: boolean;

  @ApiProperty({
    enum: StoryJobStatus,
    description: 'Current job state (e.g. queued, processing)',
  })
  status: StoryJobStatus;
}

/**
 * Response returned when cancelling a story generation job.
 * Documents the shape of the cancel result.
 */
export class CancelStoryJobResponseDto {
  @ApiProperty({ description: 'Whether the job was cancelled' })
  cancelled: boolean;

  @ApiPropertyOptional({ description: 'Reason a cancel request was rejected' })
  reason?: string;
}
