import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';
import { SubscriptionThrottleGuard } from '@/shared/guards/subscription-throttle.guard';
import { THROTTLE_LIMITS } from '@/shared/constants/throttle.constants';
import { KidOwnershipService } from './services/kid-ownership.service';
import { ErrorResponseDto, GenerateStoryDto } from './dto/story.dto';
import {
  CancelStoryJobResponseDto,
  EnqueueStoryJobResponseDto,
  StoryJobResultPendingDto,
  StoryJobStatusResponseDto,
} from './dto/story-async.dto';
import {
  QueuedStoryResult,
  StoryQueueService,
} from './queue/story-queue.service';
import {
  StoryJobResult,
  StoryJobStatusResponse,
} from './queue/story-job.interface';

/**
 * Async, queue-based story generation endpoints.
 *
 * These are ADDITIVE and run alongside the existing synchronous
 * `POST /stories/generate` and `POST /stories/generate/kid/:kidId` endpoints,
 * which remain unchanged. Clients that can tolerate eventual delivery enqueue a
 * job here and poll for status / fetch the finished story.
 *
 * Routes are namespaced under `stories/generate` (multi-segment), so they never
 * collide with the sync `POST stories/generate` or the `GET stories/:id`
 * single-segment param route on {@link StoryController}.
 */
@ApiTags('stories')
@UseGuards(AuthSessionGuard)
@ApiBearerAuth()
@Controller('stories/generate')
export class StoryAsyncController {
  private readonly logger = new Logger(StoryAsyncController.name);

  constructor(
    private readonly storyQueueService: StoryQueueService,
    private readonly kidOwnership: KidOwnershipService,
  ) {}

  @Post('async')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(SubscriptionThrottleGuard)
  @Throttle({
    medium: {
      limit: THROTTLE_LIMITS.GENERATION.FREE.LIMIT,
      ttl: THROTTLE_LIMITS.GENERATION.FREE.TTL,
    },
  })
  @ApiOperation({
    summary: 'Enqueue an AI story generation job (async, non-blocking)',
    description:
      'Accepts the same payload as the synchronous POST /stories/generate ' +
      'endpoint and returns a jobId to poll. The story is generated and ' +
      'persisted by the background worker identically to the sync path.',
  })
  @ApiBody({ type: GenerateStoryDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Job accepted onto the queue',
    type: EnqueueStoryJobResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async enqueueStoryGeneration(
    @Req() req: AuthenticatedRequest,
    @Body() body: GenerateStoryDto,
  ): Promise<QueuedStoryResult> {
    const userId = req.authUserData.userId;

    let result: QueuedStoryResult;

    // Branch identically to the sync endpoint: kidId => personalized generation.
    if (body.kidId) {
      await this.kidOwnership.getOwnedKidOrThrow(body.kidId, userId);
      result = await this.storyQueueService.queueStoryForKid({
        userId,
        kidId: body.kidId,
        themes: body.themes,
        categories: body.categories,
        seasonIds: body.seasonIds,
        kidName: body.kidName,
        metadata: this.buildMetadata(req),
      });
    } else {
      // Mirror the sync path's defaults so an async story matches a sync one.
      result = await this.storyQueueService.queueStoryGeneration({
        userId,
        theme: body.themes ?? ['Adventure'],
        category: body.categories ?? ['Bedtime Stories'],
        ageMin: body.ageMin ?? 4,
        ageMax: body.ageMax ?? 8,
        language: body.language ?? 'English',
        kidName: body.kidName,
        additionalContext: body.additionalContext,
        seasonIds: body.seasonIds,
        metadata: this.buildMetadata(req),
      });
    }

    if (!result.queued) {
      this.logger.error(
        `Failed to enqueue story job ${result.jobId}: ${result.error}`,
      );
      throw new ServiceUnavailableException(
        result.error ?? 'Failed to enqueue story generation',
      );
    }

    return result;
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get the status of an async story generation job' })
  @ApiParam({ name: 'jobId', type: String })
  @ApiOkResponse({
    description: 'Current job status',
    type: StoryJobStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Job not found',
    type: ErrorResponseDto,
  })
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<StoryJobStatusResponse> {
    return this.storyQueueService.getJobStatus(jobId);
  }

  @Get('jobs/:jobId/result')
  @ApiOperation({
    summary: 'Fetch the finished story for a completed async job',
    description:
      'Returns the generated story once the job has completed. While the job ' +
      'is still queued or processing, responds with a not-ready payload ' +
      '(ready: false) plus the current status.',
  })
  @ApiParam({ name: 'jobId', type: String })
  @ApiOkResponse({
    description: 'Finished story result, or a not-ready status payload',
    type: StoryJobResultPendingDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Job not found',
    type: ErrorResponseDto,
  })
  async getJobResult(
    @Param('jobId') jobId: string,
  ): Promise<StoryJobResult | StoryJobResultPendingDto> {
    const result = await this.storyQueueService.getJobResult(jobId);

    if (!result) {
      // Job exists (getJobResult throws NotFound otherwise) but isn't done yet.
      const { status } = await this.storyQueueService.getJobStatus(jobId);
      return { jobId, ready: false, status };
    }

    return result;
  }

  @Delete('jobs/:jobId')
  @ApiOperation({
    summary: 'Cancel a pending async story generation job',
    description:
      'Cancels a job that is still waiting. Jobs already processing, ' +
      'completed, or failed cannot be cancelled.',
  })
  @ApiParam({ name: 'jobId', type: String })
  @ApiOkResponse({
    description: 'Cancellation outcome',
    type: CancelStoryJobResponseDto,
  })
  async cancelJob(
    @Req() req: AuthenticatedRequest,
    @Param('jobId') jobId: string,
  ): Promise<CancelStoryJobResponseDto> {
    return this.storyQueueService.cancelJob(jobId, req.authUserData.userId);
  }

  private buildMetadata(req: AuthenticatedRequest): {
    clientIp?: string;
    userAgent?: string;
  } {
    const userAgentHeader = req.headers['user-agent'];
    return {
      clientIp: req.ip,
      userAgent: Array.isArray(userAgentHeader)
        ? userAgentHeader[0]
        : userAgentHeader,
    };
  }
}
