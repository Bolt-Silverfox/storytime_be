import {
  Controller,
  Sse,
  Param,
  Req,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Observable, interval, map, merge, takeWhile } from 'rxjs';
import { AuthSessionGuard, AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { JobEventsService, JobEventType } from './services/job-events.service';

@ApiTags('SSE Events')
@Controller('events')
export class SseController {
  constructor(private readonly jobEventsService: JobEventsService) {}

  /**
   * SSE endpoint for all job events for the authenticated user
   * Web clients can connect to this endpoint to receive real-time updates
   */
  @Sse('jobs')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Subscribe to all job events (SSE)',
    description:
      'Server-Sent Events endpoint for receiving real-time job updates. ' +
      'Events include progress updates, completions, and failures for both ' +
      'story generation and voice synthesis jobs.',
  })
  @ApiResponse({
    status: 200,
    description: 'SSE stream established',
    content: {
      'text/event-stream': {
        schema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['progress', 'completed', 'failed'],
            },
            jobId: { type: 'string' },
            jobType: { type: 'string', enum: ['story', 'voice'] },
            progress: { type: 'number' },
            progressMessage: { type: 'string' },
            result: {
              type: 'object',
              properties: {
                storyId: { type: 'string' },
                title: { type: 'string' },
                audioUrl: { type: 'string' },
              },
            },
            error: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  subscribeToJobs(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    const userId = req.authUserData.userId;

    // Heartbeat every 30 seconds to keep connection alive
    const heartbeat$ = interval(30000).pipe(
      map(
        () =>
          ({
            data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
            type: 'heartbeat',
          }) as MessageEvent,
      ),
    );

    // User job events
    const events$ = this.jobEventsService.subscribeToUserEvents(userId).pipe(
      map((event) => ({ data: event.data, id: event.id, type: event.type }) as MessageEvent),
    );

    // Merge heartbeat with actual events
    return merge(heartbeat$, events$);
  }

  /**
   * SSE endpoint for a specific job's events
   * Useful for tracking a single job's progress
   */
  @Sse('jobs/:jobId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Subscribe to a specific job events (SSE)',
    description:
      'Server-Sent Events endpoint for receiving real-time updates for a specific job. ' +
      'The stream automatically closes when the job completes or fails.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'The job ID to subscribe to',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'SSE stream established for specific job',
  })
  subscribeToJob(
    @Req() req: AuthenticatedRequest,
    @Param('jobId') jobId: string,
  ): Observable<MessageEvent> {
    const userId = req.authUserData.userId;

    // Track if job is finished to close stream
    let isFinished = false;

    // Heartbeat every 15 seconds for single job tracking
    const heartbeat$ = interval(15000).pipe(
      takeWhile(() => !isFinished),
      map(
        () =>
          ({
            data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
            type: 'heartbeat',
          }) as MessageEvent,
      ),
    );

    // Job-specific events
    const events$ = this.jobEventsService.subscribeToJobEvents(jobId, userId).pipe(
      map((event) => {
        // Check if job finished
        if (event.type === JobEventType.COMPLETED || event.type === JobEventType.FAILED) {
          isFinished = true;
        }
        return { data: event.data, id: event.id, type: event.type } as MessageEvent;
      }),
    );

    return merge(heartbeat$, events$);
  }
}
