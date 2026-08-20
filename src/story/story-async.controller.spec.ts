import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { StoryAsyncController } from './story-async.controller';
import { StoryQueueService } from './queue/story-queue.service';
import { SubscriptionThrottleGuard } from '@/shared/guards/subscription-throttle.guard';
import { KidOwnershipService } from './services/kid-ownership.service';
import { STORY_REPOSITORY } from './repositories/story.repository.interface';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import { GenerateStoryDto } from './dto/story.dto';
import { StoryJobStatus } from './queue/story-job.interface';

// Mock the queue service so we test the controller in isolation.
const mockStoryQueueService = {
  queueStoryGeneration: jest.fn(),
  queueStoryForKid: jest.fn(),
  getJobStatus: jest.fn(),
  getJobResult: jest.fn(),
  cancelJob: jest.fn(),
};

const mockStoryRepository = {
  findKidByIdAndParent: jest
    .fn()
    .mockResolvedValue({ id: 'kid-123', parentId: 'user-1' }),
};

const mockReq = {
  authUserData: { userId: 'user-1' },
  ip: '127.0.0.1',
  headers: { 'user-agent': 'jest' },
} as unknown as AuthenticatedRequest;

describe('StoryAsyncController', () => {
  let controller: StoryAsyncController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoryAsyncController],
      providers: [
        { provide: StoryQueueService, useValue: mockStoryQueueService },
        KidOwnershipService,
        { provide: STORY_REPOSITORY, useValue: mockStoryRepository },
      ],
    })
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      .overrideGuard(require('../shared/guards/auth.guard').AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubscriptionThrottleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StoryAsyncController>(StoryAsyncController);
    jest.clearAllMocks();
    mockStoryRepository.findKidByIdAndParent.mockResolvedValue({
      id: 'kid-123',
      parentId: 'user-1',
    });
  });

  describe('enqueueStoryGeneration', () => {
    it('enqueues a standard generation with sync-parity defaults', async () => {
      mockStoryQueueService.queueStoryGeneration.mockResolvedValue({
        queued: true,
        jobId: 'job-1',
        estimatedWaitTime: 35,
      });

      const result = await controller.enqueueStoryGeneration(mockReq, {});

      expect(mockStoryQueueService.queueStoryGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          theme: ['Adventure'],
          category: ['Bedtime Stories'],
          ageMin: 4,
          ageMax: 8,
          language: 'English',
        }),
      );
      expect(mockStoryQueueService.queueStoryForKid).not.toHaveBeenCalled();
      expect(result).toEqual({
        queued: true,
        jobId: 'job-1',
        estimatedWaitTime: 35,
      });
    });

    it('passes through provided options to the queue', async () => {
      mockStoryQueueService.queueStoryGeneration.mockResolvedValue({
        queued: true,
        jobId: 'job-2',
      });

      const body: GenerateStoryDto = {
        themes: ['Space'],
        categories: ['Sci-Fi'],
        ageMin: 6,
        ageMax: 10,
        language: 'Spanish',
        kidName: 'Ana',
        additionalContext: 'loves rockets',
        seasonIds: ['season-1'],
      };

      await controller.enqueueStoryGeneration(mockReq, body);

      expect(mockStoryQueueService.queueStoryGeneration).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: ['Space'],
          category: ['Sci-Fi'],
          ageMin: 6,
          ageMax: 10,
          language: 'Spanish',
          kidName: 'Ana',
          additionalContext: 'loves rockets',
          seasonIds: ['season-1'],
        }),
      );
    });

    it('routes to queueStoryForKid when kidId is provided', async () => {
      mockStoryQueueService.queueStoryForKid.mockResolvedValue({
        queued: true,
        jobId: 'job-3',
      });

      const body = {
        kidId: 'kid-123',
        themes: ['Ocean'],
      } as GenerateStoryDto;

      const result = await controller.enqueueStoryGeneration(mockReq, body);

      expect(mockStoryRepository.findKidByIdAndParent).toHaveBeenCalled();
      expect(mockStoryQueueService.queueStoryForKid).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          kidId: 'kid-123',
          themes: ['Ocean'],
        }),
      );
      expect(mockStoryQueueService.queueStoryGeneration).not.toHaveBeenCalled();
      expect(result.jobId).toBe('job-3');
    });

    it('throws NotFoundException when kid does not belong to the user (IDOR)', async () => {
      mockStoryRepository.findKidByIdAndParent.mockResolvedValue(null);

      await expect(
        controller.enqueueStoryGeneration(mockReq, {
          kidId: 'kid-999',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockStoryQueueService.queueStoryForKid).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailable when the queue rejects the job', async () => {
      mockStoryQueueService.queueStoryGeneration.mockResolvedValue({
        queued: false,
        jobId: 'job-x',
        error: 'redis down',
      });

      await expect(
        controller.enqueueStoryGeneration(mockReq, {}),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getJobStatus', () => {
    it('delegates to the queue service', async () => {
      const status = {
        jobId: 'job-1',
        status: StoryJobStatus.PROCESSING,
        progress: 30,
        createdAt: new Date(),
      };
      mockStoryQueueService.getJobStatus.mockResolvedValue(status);

      const result = await controller.getJobStatus('job-1');

      expect(mockStoryQueueService.getJobStatus).toHaveBeenCalledWith('job-1');
      expect(result).toBe(status);
    });
  });

  describe('getJobResult', () => {
    it('returns the finished result when available', async () => {
      const jobResult = {
        success: true,
        storyId: 'story-1',
        attemptsMade: 1,
        processingTimeMs: 100,
      };
      mockStoryQueueService.getJobResult.mockResolvedValue(jobResult);

      const result = await controller.getJobResult('job-1');

      expect(result).toBe(jobResult);
    });

    it('returns a not-ready payload while still processing', async () => {
      mockStoryQueueService.getJobResult.mockResolvedValue(null);
      mockStoryQueueService.getJobStatus.mockResolvedValue({
        jobId: 'job-1',
        status: StoryJobStatus.QUEUED,
        progress: 0,
        createdAt: new Date(),
      });

      const result = await controller.getJobResult('job-1');

      expect(result).toEqual({
        jobId: 'job-1',
        ready: false,
        status: StoryJobStatus.QUEUED,
      });
    });
  });

  describe('cancelJob', () => {
    it('delegates cancellation with the authenticated user id', async () => {
      mockStoryQueueService.cancelJob.mockResolvedValue({ cancelled: true });

      const result = await controller.cancelJob(mockReq, 'job-1');

      expect(mockStoryQueueService.cancelJob).toHaveBeenCalledWith(
        'job-1',
        'user-1',
      );
      expect(result).toEqual({ cancelled: true });
    });
  });
});
