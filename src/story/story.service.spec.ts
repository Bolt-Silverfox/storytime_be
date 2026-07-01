import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryService } from './story.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from './gemini.service';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from './text-to-speech.service';
import { GuestSessionService } from '../guest/guest-session.service';

// Mock dependencies
const mockPrismaService = {
  kid: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  story: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  theme: { findMany: jest.fn() },
  category: { findMany: jest.fn() },
  season: { findMany: jest.fn() },
  downloadedStory: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  favorite: { deleteMany: jest.fn() },
  storyProgress: { deleteMany: jest.fn() },
  userStoryProgress: { findMany: jest.fn() },
  parentRecommendation: { groupBy: jest.fn() },
  $transaction: jest.fn((args) => args), // Pass through transaction
};

const mockGeminiService = {
  generateStory: jest.fn(),
  generateStoryImage: jest.fn(),
};

const mockGuestSessionService = {
  getGuestSession: jest.fn().mockResolvedValue({ id: 'guest-1' }),
};

describe('StoryService - Library & Generation', () => {
  let service: StoryService;
  let prisma: typeof mockPrismaService;
  let gemini: typeof mockGeminiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryService,
        { provide: PrismaService, useValue: mockPrismaService },
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
        { provide: GuestSessionService, useValue: mockGuestSessionService },
      ],
    }).compile();

    service = module.get<StoryService>(StoryService);
    prisma = module.get(PrismaService);
    gemini = module.get(GeminiService);
    jest.clearAllMocks();
    mockGuestSessionService.getGuestSession.mockResolvedValue({
      id: 'guest-1',
    });
  });

  // --- 1. GENERATION TEST (The Fix) ---
  describe('generateStoryForKid', () => {
    it('should save the story with creatorKidId', async () => {
      const kidId = 'kid-123';

      // Mock Data
      prisma.kid.findUnique.mockResolvedValue({
        id: kidId,
        name: 'Tise',
        preferredCategories: [],
        excludedTags: [],
      });
      prisma.theme.findMany.mockResolvedValue([{ id: 'theme-1' }]);
      prisma.category.findMany.mockResolvedValue([{ id: 'cat-1' }]);

      gemini.generateStory.mockResolvedValue({
        title: 'AI Story',
        description: 'Desc',
        content: 'Content',
        theme: ['Theme'],
        category: ['Cat'],
        ageMin: 5,
        ageMax: 8,
        questions: [],
      });
      gemini.generateStoryImage.mockResolvedValue('image-url');
      prisma.story.create.mockResolvedValue({
        id: 'story-123',
        textContent: 'Content',
        title: 'AI Story',
      });

      // Call Method
      await service.generateStoryForKid(kidId, ['Theme'], ['Cat']);

      // VERIFY: Did we save creatorKidId?
      expect(prisma.story.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            creatorKidId: kidId, // <--- THIS IS THE CRITICAL CHECK
            title: 'AI Story',
          }),
        }),
      );
    });
  });

  // --- 2. LIBRARY TESTS ---
  describe('Library Methods', () => {
    describe('getStories', () => {
      it('should filter by minAge and maxAge', async () => {
        prisma.story.count.mockResolvedValue(1);
        prisma.story.findMany.mockResolvedValue([]);
        prisma.userStoryProgress.findMany.mockResolvedValue([]);

        await service.getStories({ userId: 'user-1', minAge: 3, maxAge: 5 });

        // Authenticated users fetch FRESH stories only: the catalog where is
        // wrapped at the top level with the read anti-join.
        expect(prisma.story.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              AND: [
                expect.objectContaining({
                  isDeleted: false,
                  // Overlap logic: story.ageMin <= 5 AND story.ageMax >= 3
                  ageMin: { lte: 5 },
                  ageMax: { gte: 3 },
                }),
                {
                  userProgress: {
                    none: { userId: 'user-1', isDeleted: false },
                  },
                },
              ],
            },
          }),
        );
      });

      it('should filter by minAge only', async () => {
        prisma.story.count.mockResolvedValue(1);
        prisma.story.findMany.mockResolvedValue([]);
        prisma.userStoryProgress.findMany.mockResolvedValue([]);

        await service.getStories({ userId: 'user-1', minAge: 4 });

        expect(prisma.story.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              AND: [
                expect.objectContaining({
                  isDeleted: false,
                  ageMax: { gte: 4 },
                }),
                {
                  userProgress: {
                    none: { userId: 'user-1', isDeleted: false },
                  },
                },
              ],
            },
          }),
        );
      });

      it('should filter by maxAge only', async () => {
        prisma.story.count.mockResolvedValue(1);
        prisma.story.findMany.mockResolvedValue([]);
        prisma.userStoryProgress.findMany.mockResolvedValue([]);

        await service.getStories({ userId: 'user-1', maxAge: 8 });

        expect(prisma.story.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              AND: [
                expect.objectContaining({
                  isDeleted: false,
                  ageMin: { lte: 8 },
                }),
                {
                  userProgress: {
                    none: { userId: 'user-1', isDeleted: false },
                  },
                },
              ],
            },
          }),
        );
      });

      it('should enrich stories with readStatus from user progress', async () => {
        const stories = [
          { id: 'story-1', title: 'Completed Story' },
          { id: 'story-2', title: 'In Progress Story' },
          { id: 'story-3', title: 'Unread Story' },
        ];
        prisma.story.count.mockResolvedValue(3);
        prisma.story.findMany.mockResolvedValue(stories);
        // The read-status enrich query uses `select`; the fresh-first backfill
        // query uses `include`. Return progress for the former, nothing for the
        // latter (the page is filled by the 3 fresh stories).
        prisma.userStoryProgress.findMany.mockImplementation((args) =>
          args?.select
            ? Promise.resolve([
                { storyId: 'story-1', progress: 100, completed: true },
                { storyId: 'story-2', progress: 50, completed: false },
              ])
            : Promise.resolve([]),
        );

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
        // Exactly one read-status enrich query (selects progress + completed).
        const selectCalls = prisma.userStoryProgress.findMany.mock.calls.filter(
          (c) => c[0]?.select,
        );
        expect(selectCalls).toHaveLength(1);
        expect(prisma.userStoryProgress.findMany).toHaveBeenCalledWith({
          where: {
            userId: 'user-1',
            storyId: { in: ['story-1', 'story-2', 'story-3'] },
            isDeleted: false,
          },
          select: { storyId: true, progress: true, completed: true },
        });
      });

      it('should treat guest progress 0 as unread', async () => {
        const stories = [
          { id: 'story-1', title: 'Reserved Story' },
          { id: 'story-2', title: 'In Progress Story' },
          { id: 'story-3', title: 'Unread Story' },
        ];
        prisma.story.count.mockResolvedValue(3);
        prisma.story.findMany.mockResolvedValue(stories);
        mockGuestSessionService.getGuestSession.mockResolvedValue({
          readingHistory: {
            'story-1': {
              progress: 0,
              lastReadAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            'story-2': {
              progress: 50,
              lastReadAt: new Date('2026-01-02T00:00:00.000Z'),
            },
          },
        });

        const result = await service.getStories({
          guestSessionId: 'guest-1',
        });

        expect(result.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'story-1', readStatus: null }),
            expect.objectContaining({ id: 'story-2', readStatus: 'reading' }),
            expect.objectContaining({ id: 'story-3', readStatus: null }),
          ]),
        );
      });
    });

    const kidId = 'kid-123';

    it('getCreatedStories: should filter by creatorKidId', async () => {
      await service.getCreatedStories(kidId);

      expect(prisma.story.findMany).toHaveBeenCalledWith(
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
      prisma.story.findMany.mockResolvedValue(stories);

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
      prisma.story.findUnique.mockResolvedValue({ id: storyId }); // Story exists

      await service.addDownload(kidId, storyId);

      expect(prisma.downloadedStory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { kidId_storyId: { kidId, storyId } },
          create: { kidId, storyId },
        }),
      );
    });

    it('removeFromLibrary: should delete from Favorites, Downloads, and Progress', async () => {
      const storyId = 'story-456';

      await service.removeFromLibrary(kidId, storyId);

      // Verify transaction contents
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({
        where: { kidId, storyId },
      });
      expect(prisma.downloadedStory.deleteMany).toHaveBeenCalledWith({
        where: { kidId, storyId },
      });
      expect(prisma.storyProgress.deleteMany).toHaveBeenCalledWith({
        where: { kidId, storyId },
      });
    });
  });

  // --- 3. HOME PAGE STORIES ---
  describe('getHomePageStories', () => {
    it('should enrich recommended, seasonal, and topLiked with readStatus', async () => {
      const userId = 'user-1';
      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        isDeleted: false,
        preferredCategories: [{ id: 'cat-1' }],
      });

      const recommended = [{ id: 'story-1', title: 'Recommended' }];
      const topLiked = [
        { id: 'story-2', title: 'Top Liked In Progress' },
        { id: 'story-3', title: 'Top Liked Unread' },
      ];

      // story.findMany: 1st = recommended (fresh), 2nd = topLiked (fresh),
      // 3rd = topLiked read-backfill (ranked by likes; returns [] here since the
      // fresh stories already fill the section). No seasonal call since
      // season.findMany returns [].
      prisma.story.findMany
        .mockResolvedValueOnce(recommended)
        .mockResolvedValueOnce(topLiked)
        .mockResolvedValueOnce([]);

      prisma.season.findMany.mockResolvedValue([]);

      // Read-status enrich uses `select`; per-section fresh-first top-up uses
      // `include`. Return progress for enrich, nothing for the top-ups (the
      // sections are already filled by the fresh stories above).
      prisma.userStoryProgress.findMany.mockImplementation((args) =>
        args?.select
          ? Promise.resolve([
              { storyId: 'story-1', progress: 100, completed: true },
              { storyId: 'story-2', progress: 50, completed: false },
              // story-3 has no progress (unread)
            ])
          : Promise.resolve([]),
      );

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

      // Verify only 1 read-status enrich query for all sections (not 1 per
      // section); the fresh-first top-ups use separate `include` queries.
      const selectCalls = prisma.userStoryProgress.findMany.mock.calls.filter(
        (c) => c[0]?.select,
      );
      expect(selectCalls).toHaveLength(1);
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

      prisma.parentRecommendation.groupBy.mockResolvedValue(mockGroupByResult);
      prisma.story.findMany.mockResolvedValue(mockStories);

      const result = await service.getTopPicksFromParents(10);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('story-1');
      expect(result[0].recommendationCount).toBe(5);
      expect(result[1].id).toBe('story-2');
      expect(result[1].recommendationCount).toBe(3);
    });

    it('should respect the limit parameter', async () => {
      prisma.parentRecommendation.groupBy.mockResolvedValue([]);

      await service.getTopPicksFromParents(5);

      expect(prisma.parentRecommendation.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('should return empty array when no recommendations exist', async () => {
      prisma.parentRecommendation.groupBy.mockResolvedValue([]);

      const result = await service.getTopPicksFromParents(10);

      expect(result).toEqual([]);
      expect(prisma.story.findMany).not.toHaveBeenCalled();
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

      prisma.parentRecommendation.groupBy.mockResolvedValue(mockGroupByResult);
      prisma.story.findMany.mockResolvedValue([mockStory]);

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
      prisma.story.findMany.mockRejectedValue(
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
      prisma.story.findMany.mockRejectedValue(
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
      prisma.story.findMany.mockRejectedValue(new Error('Network error'));

      await expect(
        service.getCreatedStories('kid-1', 'some-cursor', 10),
      ).rejects.toThrow('Network error');
    });
  });
});
