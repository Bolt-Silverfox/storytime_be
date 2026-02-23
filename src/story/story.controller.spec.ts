import { Test, TestingModule } from '@nestjs/testing';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { StoryGenerationService } from './story-generation.service';
import { StoryProgressService } from './story-progress.service';
import { StoryRecommendationService } from './story-recommendation.service';
import { DailyChallengeService } from './daily-challenge.service';
import { StoryQuotaService } from './story-quota.service';
import { StoryQueueService } from './queue';

// Mock the Services so we test the Controller in isolation
const mockStoryService = {
  getStories: jest.fn(),
  getCategories: jest.fn(),
  getThemes: jest.fn(),
  getSeasons: jest.fn(),
  createStory: jest.fn(),
  updateStory: jest.fn(),
  deleteStory: jest.fn(),
  undoDeleteStory: jest.fn(),
  addImage: jest.fn(),
  addBranch: jest.fn(),
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
  getFavorites: jest.fn(),
  getStoryById: jest.fn(),
  getCreatedStories: jest.fn(),
  getDownloads: jest.fn(),
  addDownload: jest.fn(),
  removeDownload: jest.fn(),
  removeFromLibrary: jest.fn(),
  startStoryPath: jest.fn(),
  updateStoryPath: jest.fn(),
  getStoryPathsForKid: jest.fn(),
  getStoryPathById: jest.fn(),
};

const mockStoryGenerationService = {
  generateStoryForKid: jest.fn(),
  generateStoryWithAI: jest.fn(),
};

const mockStoryProgressService = {
  setProgress: jest.fn(),
  getProgress: jest.fn(),
  getContinueReading: jest.fn(),
  getCompletedStories: jest.fn(),
};

const mockStoryRecommendationService = {
  getTopPicksFromParents: jest.fn(),
  getTopPicksFromUs: jest.fn(),
  recommendStoryToKid: jest.fn(),
  getKidRecommendations: jest.fn(),
  deleteRecommendation: jest.fn(),
  getRecommendationStats: jest.fn(),
  restrictStory: jest.fn(),
  unrestrictStory: jest.fn(),
  getRestrictedStories: jest.fn(),
  getHomePageStories: jest.fn(),
};

const mockDailyChallengeService = {
  setDailyChallenge: jest.fn(),
  getDailyChallenge: jest.fn(),
  assignDailyChallenge: jest.fn(),
  completeDailyChallenge: jest.fn(),
  getAssignmentsForKid: jest.fn(),
  getAssignmentById: jest.fn(),
  assignDailyChallengeToAllKids: jest.fn(),
  getTodaysDailyChallengeAssignment: jest.fn(),
  getWeeklyDailyChallengeAssignments: jest.fn(),
};

const mockStoryQuotaService = {
  getQuotaStatus: jest.fn(),
  recordNewStoryAccess: jest.fn(),
};

const mockStoryQueueService = {
  queueStoryGeneration: jest.fn(),
  queueStoryForKid: jest.fn(),
  getJobStatus: jest.fn(),
  getJobResult: jest.fn(),
  cancelJob: jest.fn(),
  getUserPendingJobs: jest.fn(),
  getQueueStats: jest.fn(),
};

describe('StoryController', () => {
  let controller: StoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoryController],
      providers: [
        { provide: StoryService, useValue: mockStoryService },
        {
          provide: StoryGenerationService,
          useValue: mockStoryGenerationService,
        },
        { provide: StoryProgressService, useValue: mockStoryProgressService },
        {
          provide: StoryRecommendationService,
          useValue: mockStoryRecommendationService,
        },
        { provide: DailyChallengeService, useValue: mockDailyChallengeService },
        { provide: StoryQuotaService, useValue: mockStoryQuotaService },
        { provide: StoryQueueService, useValue: mockStoryQueueService },
        {
          provide: 'CACHE_MANAGER',
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    })
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      .overrideGuard(require('../shared/guards/auth.guard').AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(
        require('../shared/guards/subscription-throttle.guard')
          .SubscriptionThrottleGuard,
      )
      .useValue({ canActivate: () => true })
      .overrideGuard(
        require('../shared/guards/story-access.guard').StoryAccessGuard,
      )
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StoryController>(StoryController);
    jest.clearAllMocks();
  });

  // --- 1. TEST THE GENERATION ENDPOINT ---
  describe('generateStoryForKid', () => {
    it('should call service with correct kidId and arrays for theme/category', async () => {
      const kidId = 'kid-123';
      const theme = 'Space';
      const category = 'Adventure';

      await controller.generateStoryForKid(kidId, theme, category);

      // Verify the controller converts single strings to arrays for the service
      expect(
        mockStoryGenerationService.generateStoryForKid,
      ).toHaveBeenCalledWith(kidId, ['Space'], ['Adventure']);
    });

    it('should handle missing theme/category params', async () => {
      const kidId = 'kid-123';
      await controller.generateStoryForKid(kidId);

      expect(
        mockStoryGenerationService.generateStoryForKid,
      ).toHaveBeenCalledWith(kidId, undefined, undefined);
    });
  });

  // --- 2. TEST LIBRARY ENDPOINTS ---
  describe('Library Features', () => {
    const kidId = 'kid-123';
    const storyId = 'story-456';

    it('getCreated: should call getCreatedStories service method', async () => {
      await controller.getCreated(kidId);
      expect(mockStoryService.getCreatedStories).toHaveBeenCalledWith(kidId);
    });

    it('getDownloads: should call getDownloads service method', async () => {
      await controller.getDownloads(kidId);
      expect(mockStoryService.getDownloads).toHaveBeenCalledWith(kidId);
    });

    it('addDownload: should call addDownload service method', async () => {
      await controller.addDownload(kidId, storyId);
      expect(mockStoryService.addDownload).toHaveBeenCalledWith(kidId, storyId);
    });

    it('removeFromLibrary: should call removeFromLibrary service method', async () => {
      await controller.removeFromLibrary(kidId, storyId);
      expect(mockStoryService.removeFromLibrary).toHaveBeenCalledWith(
        kidId,
        storyId,
      );
    });
  });

  // --- 3. TOP PICKS ENDPOINT ---
  describe('getTopPicksFromParents', () => {
    it('should call service with capped limit of 50 when exceeding max', async () => {
      await controller.getTopPicksFromParents(100);
      expect(
        mockStoryRecommendationService.getTopPicksFromParents,
      ).toHaveBeenCalledWith(50);
    });

    it('should call service with provided limit when within bounds', async () => {
      await controller.getTopPicksFromParents(25);
      expect(
        mockStoryRecommendationService.getTopPicksFromParents,
      ).toHaveBeenCalledWith(25);
    });

    it('should use default limit of 10', async () => {
      await controller.getTopPicksFromParents(10);
      expect(
        mockStoryRecommendationService.getTopPicksFromParents,
      ).toHaveBeenCalledWith(10);
    });

    it('should return the result from the service', async () => {
      const mockResult = [
        { id: 'story-1', title: 'Top Story', recommendationCount: 5 },
      ];
      mockStoryRecommendationService.getTopPicksFromParents.mockResolvedValue(
        mockResult,
      );

      const result = await controller.getTopPicksFromParents(10);

      expect(result).toEqual(mockResult);
    });
  });
});
