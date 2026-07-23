import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryService } from './story.service';
import { StoryFeedService } from './story-feed.service';
import { NotificationService } from '../notification/notification.service';
import { STORY_REPOSITORY } from './repositories/story.repository.interface';
import { GeminiService } from './gemini.service';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from './text-to-speech.service';
import { StoryFavoriteService } from './story-favorite.service';
import { StoryDownloadService } from './story-download.service';
import { StoryPathService } from './story-path.service';
import { StoryMetadataService } from './story-metadata.service';
import { StoryProgressService } from './story-progress.service';
import { StoryRecommendationService } from './story-recommendation.service';
import { DailyChallengeService } from './daily-challenge.service';
import { StoryGenerationService } from './story-generation.service';

// Mock dependencies — StoryService now routes all DB access through
// STORY_REPOSITORY, so we mock the repository methods it calls.
const mockStoryRepository = {
  findUniqueKidRaw: jest.fn(),
  findManyKidsRaw: jest.fn(),
  findUniqueUserRaw: jest.fn(),
  createStoryRaw: jest.fn(),
  updateStoryRaw: jest.fn(),
  deleteStoryRaw: jest.fn(),
  findManyStoriesRaw: jest.fn(),
  findUniqueStoryRaw: jest.fn(),
  countStoriesRaw: jest.fn(),
  findManyThemesRaw: jest.fn(),
  findManyCategoriesRaw: jest.fn(),
  findManySeasonsRaw: jest.fn(),
  findManyUserStoryProgressRaw: jest.fn(),
  findManyDailyChallengeAssignmentsRaw: jest.fn(),
  findFirstDailyChallengeAssignmentRaw: jest.fn(),
  createDailyChallengeAssignmentRaw: jest.fn(),
  findFirstDailyChallengeRaw: jest.fn(),
  createDailyChallengeRaw: jest.fn(),
  upsertDownload: jest.fn(),
  removeFromLibraryTransaction: jest.fn(),
  groupParentRecommendationsByStory: jest.fn(),
  getRandomStoryIdsFromStories: jest.fn(),
  getDeterministicStoryIdsFromStories: jest.fn(),
};

const mockGeminiService = {
  generateStory: jest.fn(),
  generateStoryImage: jest.fn(),
};

// StoryService delegates all AI generation to the canonical
// StoryGenerationService, so we mock it and assert the delegation.
const mockStoryGenerationService = {
  generateStoryWithAI: jest.fn(),
  generateStoryForKid: jest.fn(),
};

describe('StoryService - Library & Generation', () => {
  let service: StoryService;
  let prisma: typeof mockStoryRepository;
  let generation: typeof mockStoryGenerationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryService,
        StoryFeedService,
        { provide: STORY_REPOSITORY, useValue: mockStoryRepository },
        { provide: GeminiService, useValue: mockGeminiService },
        {
          provide: ElevenLabsService,
          useValue: { generateAudioBuffer: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: UploadService,
          useValue: { uploadAudioBuffer: jest.fn().mockResolvedValue('url') },
        },
        {
          provide: TextToSpeechService,
          useValue: {
            textToSpeechCloudUrl: jest
              .fn()
              .mockResolvedValue('http://audio.url'),
          },
        },
        {
          provide: 'CACHE_MANAGER',
          useValue: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
        },
        { provide: StoryFavoriteService, useValue: {} },
        { provide: StoryDownloadService, useValue: {} },
        { provide: StoryPathService, useValue: {} },
        { provide: StoryMetadataService, useValue: {} },
        { provide: StoryProgressService, useValue: {} },
        { provide: StoryRecommendationService, useValue: {} },
        { provide: DailyChallengeService, useValue: {} },
        {
          provide: StoryGenerationService,
          useValue: mockStoryGenerationService,
        },
        {
          provide: NotificationService,
          useValue: {
            broadcastNewStoryToUsers: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<StoryService>(StoryService);
    prisma = module.get(STORY_REPOSITORY);
    generation = module.get(StoryGenerationService);
    jest.clearAllMocks();
  });

  // --- 1. GENERATION TESTS (The Fix): delegate to canonical service ---
  // The atomic persist + creatorKidId behavior itself is verified in
  // story-generation.service.spec.ts. StoryService's job is now to forward
  // to StoryGenerationService so the sync controller path and the async
  // BullMQ path produce identical stories.
  describe('generateStoryForKid', () => {
    it('should delegate to StoryGenerationService with the kid id and args, and return its result', async () => {
      const kidId = 'kid-123';
      const created = {
        id: 'story-123',
        textContent: 'Content',
        title: 'AI Story',
        creatorKidId: kidId,
      };
      generation.generateStoryForKid.mockResolvedValue(created);

      const result = await service.generateStoryForKid(
        kidId,
        ['Theme'],
        ['Cat'],
      );

      // VERIFY: forwarded to the canonical implementation with 1:1 args.
      expect(generation.generateStoryForKid).toHaveBeenCalledWith(
        kidId,
        ['Theme'],
        ['Cat'],
        undefined,
        undefined,
      );
      // And the canonical result (with creatorKidId) is passed straight through.
      expect(result).toBe(created);
      expect(result.creatorKidId).toBe(kidId);
      // StoryService must NOT perform its own persistence anymore.
      expect(prisma.createStoryRaw).not.toHaveBeenCalled();
    });
  });

  describe('generateStoryWithAI', () => {
    it('should delegate to StoryGenerationService and return its result', async () => {
      const options = {
        theme: ['Theme'],
        category: ['Cat'],
        ageMin: 4,
        ageMax: 8,
        creatorKidId: 'kid-123',
      };
      const created = { id: 'story-456', title: 'AI Story' };
      generation.generateStoryWithAI.mockResolvedValue(created);

      const result = await service.generateStoryWithAI(options);

      expect(generation.generateStoryWithAI).toHaveBeenCalledWith(options);
      expect(result).toBe(created);
      expect(prisma.createStoryRaw).not.toHaveBeenCalled();
    });
  });

  // --- 2. LIBRARY TESTS ---
  describe('Library Methods', () => {
    describe('getStories', () => {
      it('should filter by minAge and maxAge', async () => {
        prisma.countStoriesRaw.mockResolvedValue(1);
        prisma.findManyStoriesRaw.mockResolvedValue([]);
        prisma.findManyUserStoryProgressRaw.mockResolvedValue([]);

        await service.getStories({ userId: 'user-1', minAge: 3, maxAge: 5 });

        expect(prisma.findManyStoriesRaw).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              // Check overlap logic: story.ageMin <= 5 AND story.ageMax >= 3
              ageMin: { lte: 5 },
              ageMax: { gte: 3 },
            }),
          }),
        );
      });

      it('should filter by minAge only', async () => {
        prisma.countStoriesRaw.mockResolvedValue(1);
        prisma.findManyStoriesRaw.mockResolvedValue([]);
        prisma.findManyUserStoryProgressRaw.mockResolvedValue([]);

        await service.getStories({ userId: 'user-1', minAge: 4 });

        expect(prisma.findManyStoriesRaw).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              ageMax: { gte: 4 },
            }),
          }),
        );
      });

      it('should filter by maxAge only', async () => {
        prisma.countStoriesRaw.mockResolvedValue(1);
        prisma.findManyStoriesRaw.mockResolvedValue([]);
        prisma.findManyUserStoryProgressRaw.mockResolvedValue([]);

        await service.getStories({ userId: 'user-1', maxAge: 8 });

        expect(prisma.findManyStoriesRaw).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              ageMin: { lte: 8 },
            }),
          }),
        );
      });

      it('should enrich stories with readStatus from user progress', async () => {
        const stories = [
          { id: 'story-1', title: 'Completed Story' },
          { id: 'story-2', title: 'In Progress Story' },
          { id: 'story-3', title: 'Unread Story' },
        ];
        prisma.countStoriesRaw.mockResolvedValue(3);
        prisma.findManyStoriesRaw.mockResolvedValue(stories);
        prisma.findManyUserStoryProgressRaw.mockResolvedValue([
          { storyId: 'story-1', completed: true },
          { storyId: 'story-2', completed: false },
        ]);

        const result = await service.getStories({ userId: 'user-1' });

        // sortByReadStatus orders: null (unread) first, then reading, then done
        expect(result.data[0]).toEqual(
          expect.objectContaining({ id: 'story-3', readStatus: null }),
        );
        expect(result.data[1]).toEqual(
          expect.objectContaining({ id: 'story-2', readStatus: 'reading' }),
        );
        expect(result.data[2]).toEqual(
          expect.objectContaining({ id: 'story-1', readStatus: 'done' }),
        );
        expect(prisma.findManyUserStoryProgressRaw).toHaveBeenCalledTimes(1);
        expect(prisma.findManyUserStoryProgressRaw).toHaveBeenCalledWith({
          where: {
            userId: 'user-1',
            storyId: { in: ['story-1', 'story-2', 'story-3'] },
            isDeleted: false,
          },
          select: { storyId: true, completed: true },
        });
      });
    });

    const kidId = 'kid-123';

    it('getCreatedStories: should filter by creatorKidId', async () => {
      await service.getCreatedStories(kidId);

      expect(prisma.findManyStoriesRaw).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            creatorKidId: kidId,
            isDeleted: false,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
      );
    });

    it('getCreatedStories: should return cursor-paginated when limit provided', async () => {
      const stories = [
        { id: 'story-1', title: 'Story 1' },
        { id: 'story-2', title: 'Story 2' },
        { id: 'story-3', title: 'Story 3' },
      ];
      prisma.findManyStoriesRaw.mockResolvedValue(stories);

      const result = await service.getCreatedStories(kidId, undefined, 2);

      expect(result).toEqual({
        data: [
          { id: 'story-1', title: 'Story 1' },
          { id: 'story-2', title: 'Story 2' },
        ],
        pagination: {
          nextCursor: 'story-2',
          hasNextPage: true,
        },
      });
    });

    it('addDownload: should use upsert to prevent duplicates', async () => {
      const storyId = 'story-456';
      prisma.findUniqueStoryRaw.mockResolvedValue({ id: storyId }); // Story exists

      await service.addDownload(kidId, storyId);

      // Repository encapsulates the upsert (where/create/update) — verify it is
      // invoked with the correct kid/story to prevent duplicate downloads.
      expect(prisma.upsertDownload).toHaveBeenCalledWith(kidId, storyId);
    });

    it('removeFromLibrary: should delete from Favorites, Downloads, and Progress', async () => {
      const storyId = 'story-456';

      await service.removeFromLibrary(kidId, storyId);

      // Repository runs the favorite/download/progress deletes in one
      // transaction — verify it is invoked for the correct kid/story.
      expect(prisma.removeFromLibraryTransaction).toHaveBeenCalledWith(
        kidId,
        storyId,
      );
    });
  });

  // --- 3. HOME PAGE STORIES ---
  describe('getHomePageStories', () => {
    it('should enrich recommended, seasonal, and topLiked with readStatus', async () => {
      const userId = 'user-1';
      prisma.findUniqueUserRaw.mockResolvedValue({
        id: userId,
        isDeleted: false,
        preferredCategories: [{ id: 'cat-1' }],
      });

      const recommended = [{ id: 'story-1', title: 'Recommended' }];
      const topLiked = [
        { id: 'story-2', title: 'Top Liked In Progress' },
        { id: 'story-3', title: 'Top Liked Unread' },
      ];

      // story.findMany: 1st call = recommended, 2nd call = topLiked
      // (no seasonal call since season.findMany returns [])
      prisma.findManyStoriesRaw
        .mockResolvedValueOnce(recommended)
        .mockResolvedValueOnce(topLiked);

      prisma.findManySeasonsRaw.mockResolvedValue([]);

      prisma.findManyUserStoryProgressRaw.mockResolvedValue([
        { storyId: 'story-1', completed: true },
        { storyId: 'story-2', completed: false },
        // story-3 has no progress (unread)
      ]);

      const result = await service.getHomePageStories(userId);

      expect(result.recommended[0]).toEqual(
        expect.objectContaining({ id: 'story-1', readStatus: 'done' }),
      );
      expect(result.seasonal).toEqual([]);
      // sortByReadStatus orders: null (unread) first, then reading, then done
      expect(result.topLiked[0]).toEqual(
        expect.objectContaining({ id: 'story-3', readStatus: null }),
      );
      expect(result.topLiked[1]).toEqual(
        expect.objectContaining({ id: 'story-2', readStatus: 'reading' }),
      );

      // Verify only 1 DB call for progress (not 1 per section)
      expect(prisma.findManyUserStoryProgressRaw).toHaveBeenCalledTimes(1);
    });
  });

  // --- 4. TOP PICKS TESTS ---
  describe('getTopPicksFromParents', () => {
    it('should return stories sorted by recommendation count', async () => {
      const mockGroupByResult = [
        { storyId: 'story-1', _count: { storyId: 5 } },
        { storyId: 'story-2', _count: { storyId: 3 } },
      ];
      const mockStories = [
        {
          id: 'story-2',
          title: 'Story Two',
          themes: [],
          categories: [],
          images: [],
        },
        {
          id: 'story-1',
          title: 'Story One',
          themes: [],
          categories: [],
          images: [],
        },
      ];

      prisma.groupParentRecommendationsByStory.mockResolvedValue(
        mockGroupByResult,
      );
      prisma.findManyStoriesRaw.mockResolvedValue(mockStories);

      const result = await service.getTopPicksFromParents(10);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('story-1');
      expect(result[0].recommendationCount).toBe(5);
      expect(result[1].id).toBe('story-2');
      expect(result[1].recommendationCount).toBe(3);
    });

    it('should respect the limit parameter', async () => {
      prisma.groupParentRecommendationsByStory.mockResolvedValue([]);

      await service.getTopPicksFromParents(5);

      expect(prisma.groupParentRecommendationsByStory).toHaveBeenCalledWith(5);
    });

    it('should return empty array when no recommendations exist', async () => {
      prisma.groupParentRecommendationsByStory.mockResolvedValue([]);

      const result = await service.getTopPicksFromParents(10);

      expect(result).toEqual([]);
      expect(prisma.findManyStoriesRaw).not.toHaveBeenCalled();
    });

    it('should include themes, categories, and images in the result', async () => {
      const mockGroupByResult = [
        { storyId: 'story-1', _count: { storyId: 2 } },
      ];
      const mockStory = {
        id: 'story-1',
        title: 'Test Story',
        themes: [{ id: 'theme-1', name: 'Adventure' }],
        categories: [{ id: 'cat-1', name: 'Fantasy' }],
        images: [{ url: 'http://example.com/img.png' }],
      };

      prisma.groupParentRecommendationsByStory.mockResolvedValue(
        mockGroupByResult,
      );
      prisma.findManyStoriesRaw.mockResolvedValue([mockStory]);

      const result = await service.getTopPicksFromParents(10);

      expect(result[0]).toHaveProperty('themes');
      expect(result[0]).toHaveProperty('categories');
      expect(result[0]).toHaveProperty('images');
      expect(result[0].themes).toEqual([{ id: 'theme-1', name: 'Adventure' }]);
    });
  });

  // --- 5. CURSOR ERROR HANDLING ---
  describe('withCursorErrorHandling (via getCreatedStories)', () => {
    it('should throw BadRequestException for invalid cursor (P2025)', async () => {
      prisma.findManyStoriesRaw.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.0.0',
        }),
      );

      await expect(
        service.getCreatedStories('kid-1', 'invalid-cursor', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('should re-throw non-P2025 Prisma errors', async () => {
      prisma.findManyStoriesRaw.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );

      await expect(
        service.getCreatedStories('kid-1', 'some-cursor', 10),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });

    it('should re-throw non-Prisma errors', async () => {
      prisma.findManyStoriesRaw.mockRejectedValue(new Error('Network error'));

      await expect(
        service.getCreatedStories('kid-1', 'some-cursor', 10),
      ).rejects.toThrow('Network error');
    });
  });
});
