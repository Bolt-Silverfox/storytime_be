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
  story: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  theme: { findMany: jest.fn() },
  category: { findMany: jest.fn() },
  downloadedStory: { findMany: jest.fn(), upsert: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
  favorite: { deleteMany: jest.fn() },
  storyProgress: { deleteMany: jest.fn() },
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
        { provide: ElevenLabsService, useValue: { generateAudioBuffer: jest.fn().mockResolvedValue({}) } },
        { provide: UploadService, useValue: { uploadAudioBuffer: jest.fn().mockResolvedValue('url') } },
        { provide: TextToSpeechService, useValue: {} },
        { provide: 'CACHE_MANAGER', useValue: { del: jest.fn(), get: jest.fn(), set: jest.fn() } },
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
      prisma.kid.findUnique.mockResolvedValue({ id: kidId, name: 'Tise', preferredCategories: [], excludedTags: [] });
      prisma.theme.findMany.mockResolvedValue([{ id: 'theme-1' }]);
      prisma.category.findMany.mockResolvedValue([{ id: 'cat-1' }]);

      gemini.generateStory.mockResolvedValue({
        title: 'AI Story',
        description: 'Desc',
        content: 'Content',
        theme: ['Theme'],
        category: ['Cat'],
        ageMin: 5, ageMax: 8, questions: []
      });
      gemini.generateStoryImage.mockResolvedValue('image-url');

      // Call Method
      await service.generateStoryForKid(kidId, ['Theme'], ['Cat']);

      // VERIFY: Did we save creatorKidId?
      expect(prisma.story.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          creatorKidId: kidId, // <--- THIS IS THE CRITICAL CHECK
          title: 'AI Story',
        }),
      }));
    });
  });

  // --- 2. LIBRARY TESTS ---
  describe('Library Methods', () => {
    const kidId = 'kid-123';

    it('getCreatedStories: should filter by creatorKidId', async () => {
      await service.getCreatedStories(kidId);

      expect(prisma.story.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          creatorKidId: kidId, // <--- Ensures we only fetch THEIR stories
          isDeleted: false,
        },
        orderBy: { createdAt: 'desc' },
      }));
    });

    it('addDownload: should use upsert to prevent duplicates', async () => {
      const storyId = 'story-456';
      prisma.story.findUnique.mockResolvedValue({ id: storyId }); // Story exists

      await service.addDownload(kidId, storyId);

      expect(prisma.downloadedStory.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { kidId_storyId: { kidId, storyId } },
        create: { kidId, storyId },
      }));
    });

    it('removeFromLibrary: should delete from Favorites, Downloads, and Progress', async () => {
      const storyId = 'story-456';

      await service.removeFromLibrary(kidId, storyId);

      // Verify transaction contents
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({ where: { kidId, storyId } });
      expect(prisma.downloadedStory.deleteMany).toHaveBeenCalledWith({ where: { kidId, storyId } });
      expect(prisma.storyProgress.deleteMany).toHaveBeenCalledWith({ where: { kidId, storyId } });
    });
  });
});