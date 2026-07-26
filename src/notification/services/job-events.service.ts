import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable, filter, map } from 'rxjs';

/**
 * Job Event Types
 */
export enum JobEventType {
  PROGRESS = 'progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Job Event Payload
 */
export interface JobEvent {
  type: JobEventType;
  jobId: string;
  userId: string;
  jobType: 'story' | 'voice';
  progress?: number;
  progressMessage?: string;
  result?: {
    storyId?: string;
    title?: string;
    audioUrl?: string;
    // Voice batch fields: which paragraph became ready, and (on completion) the
    // batch tally so a reader knows whether every position was narrated.
    paragraphIndex?: number;
    totalParagraphs?: number;
    completedParagraphs?: number;
    failedParagraphs?: number;
  };
  error?: string;
  timestamp: Date;
}

/**
 * SSE Message Event format for NestJS
 */
export interface SseMessageEvent {
  data: string;
  id?: string;
  type?: string;
  retry?: number;
}

/**
 * Job Events Service
 * Manages SSE connections and broadcasts job events to connected clients
 */
@Injectable()
export class JobEventsService {
  private readonly logger = new Logger(JobEventsService.name);
  private readonly eventSubject = new Subject<JobEvent>();

  /**
   * Emit a job event to all subscribers
   */
  emit(event: JobEvent): void {
    this.logger.debug(
      `Emitting job event: ${event.type} for job ${event.jobId}`,
    );
    this.eventSubject.next(event);
  }

  /**
   * Emit a progress event
   */
  emitProgress(
    jobId: string,
    userId: string,
    jobType: 'story' | 'voice',
    progress: number,
    progressMessage?: string,
  ): void {
    this.emit({
      type: JobEventType.PROGRESS,
      jobId,
      userId,
      jobType,
      progress,
      progressMessage,
      timestamp: new Date(),
    });
  }

  /**
   * Emit a completion event for story jobs
   */
  emitStoryCompleted(
    jobId: string,
    userId: string,
    storyId: string,
    title: string,
  ): void {
    this.emit({
      type: JobEventType.COMPLETED,
      jobId,
      userId,
      jobType: 'story',
      progress: 100,
      result: { storyId, title },
      timestamp: new Date(),
    });
  }

  /**
   * Emit a completion event for voice jobs
   */
  emitVoiceCompleted(jobId: string, userId: string, audioUrl: string): void {
    this.emit({
      type: JobEventType.COMPLETED,
      jobId,
      userId,
      jobType: 'voice',
      progress: 100,
      result: { audioUrl },
      timestamp: new Date(),
    });
  }

  /**
   * Emit a per-paragraph readiness event for a voice batch.
   *
   * The reader consumes these to append playable audio to its playlist as each
   * paragraph finishes, rather than waiting for the whole batch. `progress` is
   * the batch-level percentage so a progress bar can advance alongside.
   */
  emitVoiceParagraphReady(
    jobId: string,
    userId: string,
    paragraphIndex: number,
    audioUrl: string,
    progress: number,
  ): void {
    this.emit({
      type: JobEventType.PROGRESS,
      jobId,
      userId,
      jobType: 'voice',
      progress,
      result: { paragraphIndex, audioUrl },
      timestamp: new Date(),
    });
  }

  /**
   * Emit the terminal completion event for a voice batch. Carries the tally so
   * the reader can tell full narration from a partial one (some paragraphs may
   * have exhausted every provider). Emit ONLY when no self-heal retry remains,
   * otherwise the reader would stop listening before healed paragraphs arrive.
   */
  emitVoiceBatchCompleted(
    jobId: string,
    userId: string,
    summary: {
      totalParagraphs: number;
      completedParagraphs: number;
      failedParagraphs: number;
    },
  ): void {
    this.emit({
      type: JobEventType.COMPLETED,
      jobId,
      userId,
      jobType: 'voice',
      progress: 100,
      result: {
        totalParagraphs: summary.totalParagraphs,
        completedParagraphs: summary.completedParagraphs,
        failedParagraphs: summary.failedParagraphs,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Emit a failure event
   */
  emitFailed(
    jobId: string,
    userId: string,
    jobType: 'story' | 'voice',
    error: string,
  ): void {
    this.emit({
      type: JobEventType.FAILED,
      jobId,
      userId,
      jobType,
      error,
      timestamp: new Date(),
    });
  }

  /**
   * Subscribe to events for a specific user
   * Returns an Observable that can be used with @Sse() decorator
   */
  subscribeToUserEvents(userId: string): Observable<SseMessageEvent> {
    this.logger.log(`User ${userId} subscribed to job events via SSE`);

    return this.eventSubject.asObservable().pipe(
      filter((event) => event.userId === userId),
      map((event) => this.formatSseMessage(event)),
    );
  }

  /**
   * Subscribe to events for a specific job
   * Returns an Observable that can be used with @Sse() decorator
   */
  subscribeToJobEvents(
    jobId: string,
    userId: string,
  ): Observable<SseMessageEvent> {
    this.logger.log(`User ${userId} subscribed to job ${jobId} events via SSE`);

    return this.eventSubject.asObservable().pipe(
      filter((event) => event.jobId === jobId && event.userId === userId),
      map((event) => this.formatSseMessage(event)),
    );
  }

  /**
   * Format event for SSE transmission
   */
  private formatSseMessage(event: JobEvent): SseMessageEvent {
    return {
      data: JSON.stringify({
        type: event.type,
        jobId: event.jobId,
        jobType: event.jobType,
        progress: event.progress,
        progressMessage: event.progressMessage,
        result: event.result,
        error: event.error,
        timestamp: event.timestamp.toISOString(),
      }),
      id: `${event.jobId}-${Date.now()}`,
      type: event.type,
    };
  }
}
