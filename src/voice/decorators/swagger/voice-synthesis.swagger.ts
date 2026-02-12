import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StoryContentAudioDto, AsyncStorySynthesisDto } from '../../dto/voice.dto';

// === ASYNC VOICE SYNTHESIS DECORATORS ===

export function ApiQueueTextSynthesis() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Queue async text-to-speech synthesis',
      description:
        'Queues text for asynchronous voice synthesis. Returns a jobId for status polling.',
    }),
    ApiBody({ type: StoryContentAudioDto }),
    ApiResponse({
      status: 201,
      description: 'Job queued successfully',
      schema: {
        type: 'object',
        properties: {
          queued: { type: 'boolean' },
          jobId: { type: 'string' },
          estimatedWaitTime: { type: 'number', description: 'Seconds' },
        },
      },
    }),
    ApiResponse({ status: 401, description: 'Unauthorized' }),
  );
}

export function ApiQueueStorySynthesis() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Queue async story audio synthesis',
      description:
        'Queues a story for asynchronous audio generation. Returns a jobId for status polling.',
    }),
    ApiBody({ type: AsyncStorySynthesisDto }),
    ApiResponse({
      status: 201,
      description: 'Job queued successfully',
      schema: {
        type: 'object',
        properties: {
          queued: { type: 'boolean' },
          jobId: { type: 'string' },
          estimatedWaitTime: { type: 'number', description: 'Seconds' },
        },
      },
    }),
    ApiResponse({ status: 401, description: 'Unauthorized' }),
  );
}

export function ApiGetJobStatus() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get async voice synthesis job status' }),
    ApiParam({ name: 'jobId', type: String }),
    ApiResponse({
      status: 200,
      description: 'Job status',
      schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'queued',
              'processing',
              'synthesizing',
              'uploading',
              'completed',
              'failed',
            ],
          },
          progress: { type: 'number', minimum: 0, maximum: 100 },
          progressMessage: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          startedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time' },
          result: {
            type: 'object',
            properties: {
              audioUrl: { type: 'string' },
              durationSeconds: { type: 'number' },
            },
          },
          error: { type: 'string' },
          estimatedTimeRemaining: { type: 'number' },
        },
      },
    }),
    ApiResponse({ status: 404, description: 'Job not found' }),
  );
}

export function ApiGetJobResult() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get completed job result' }),
    ApiParam({ name: 'jobId', type: String }),
    ApiResponse({
      status: 200,
      description: 'Job result (null if not completed)',
      schema: {
        type: 'object',
        nullable: true,
        properties: {
          success: { type: 'boolean' },
          audioUrl: { type: 'string' },
          durationSeconds: { type: 'number' },
          attemptsMade: { type: 'number' },
          processingTimeMs: { type: 'number' },
        },
      },
    }),
    ApiResponse({ status: 404, description: 'Job not found' }),
  );
}

export function ApiCancelJob() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Cancel a pending voice synthesis job' }),
    ApiParam({ name: 'jobId', type: String }),
    ApiResponse({
      status: 200,
      description: 'Cancellation result',
      schema: {
        type: 'object',
        properties: {
          cancelled: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    }),
  );
}

export function ApiGetUserPendingJobs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get user pending voice synthesis jobs' }),
    ApiResponse({
      status: 200,
      description: 'List of pending jobs',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string' },
            progress: { type: 'number' },
          },
        },
      },
    }),
  );
}

export function ApiGetQueueStats() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get voice synthesis queue statistics' }),
    ApiResponse({
      status: 200,
      description: 'Queue statistics',
      schema: {
        type: 'object',
        properties: {
          waiting: { type: 'number' },
          active: { type: 'number' },
          completed: { type: 'number' },
          failed: { type: 'number' },
          delayed: { type: 'number' },
        },
      },
    }),
  );
}
