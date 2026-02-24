import { Test, TestingModule } from '@nestjs/testing';
import { StoryService } from './story.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from './gemini.service';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from './text-to-speech.service';
import { Cache } from '@nestjs/cache-manager';

// Mock dependencies
const mockPrismaService = {
  kid: { findUnique: jest.fn() },
  story: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  theme: { findMany: jest.fn() },
  category: { findMany: jest.fn() },
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
      ],
    }).compile();

    service = module.get<StoryService>(StoryService);
    prisma = module.get(PrismaService);
    gemini = module.get(GeminiService);
    jest.clearAllMocks();
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

        expect(prisma.story.findMany).toHaveBeenCalledWith(
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
        prisma.story.count.mockResolvedValue(1);
        prisma.story.findMany.mockResolvedValue([]);
        prisma.userStoryProgress.findMany.mockResolvedValue([]);

        await service.getStories({ userId: 'user-1', minAge: 4 });

        expect(prisma.story.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              ageMax: { gte: 4 },
            }),
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
            where: expect.objectContaining({
              isDeleted: false,
              ageMin: { lte: 8 },
            }),
          }),
        );
      });
    });

    const kidId = 'kid-123';

    it('getCreatedStories: should filter by creatorKidId', async () => {
      await service.getCreatedStories(kidId);

      expect(prisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            creatorKidId: kidId, // <--- Ensures we only fetch THEIR stories
            isDeleted: false,
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
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

  // --- 3. TOP PICKS TESTS ---
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
});
