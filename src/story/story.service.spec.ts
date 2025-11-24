import { Test, TestingModule } from '@nestjs/testing';
import { StoryService } from './story.service';
import { PrismaService } from '../prisma/prisma.service';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from './text-to-speech.service';
import { GeminiService } from './gemini.service';
import { Logger } from '@nestjs/common';

// 1. Create a Mock for Prisma
const mockPrismaService = {
  storyProgress: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  story: {
    findUnique: jest.fn(),
  },
  kid: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('StoryService - Reading Level Logic', () => {
  let service: StoryService;
  let prisma: typeof mockPrismaService;

  beforeEach(async () => {
    // 2. Setup the Testing Module
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ElevenLabsService, useValue: {} }, // Mock other dependencies as empty objects
        { provide: UploadService, useValue: {} },
        { provide: TextToSpeechService, useValue: {} },
        { provide: GeminiService, useValue: {} },
      ],
    }).compile();

    service = module.get<StoryService>(StoryService);
    prisma = module.get(PrismaService);

    // Silence the logger for clean test output
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper to let background promises finish
  const waitForBackgroundTasks = () =>
    new Promise((resolve) => setTimeout(resolve, 10));

  describe('adjustReadingLevel (via setProgress)', () => {
    const kidId = 'kid-123';
    const storyId = 'story-456';
    const initialLevel = 5;

    it('should LEVEL UP the kid if reading speed is fast (>120 WPM) on a challenging story', async () => {
      // ARRANGE
      // 1. Mock the kid (Current Level 5)
      prisma.kid.findUnique.mockResolvedValue({
        id: kidId,
        currentReadingLevel: initialLevel,
      });

      // 2. Mock the story (Difficulty 5, 400 words)
      prisma.story.findUnique.mockResolvedValue({
        id: storyId,
        difficultyLevel: 5,
        wordCount: 300,
      });

      // 3. Mock existing progress (Not completed yet)
      prisma.storyProgress.findUnique.mockResolvedValue(null);
      prisma.storyProgress.upsert.mockResolvedValue({ id: 'prog-1' } as any);

      // ACT
      // User finishes story in 2 minutes (120 seconds).
      // WPM Calculation: 300 words / 2 mins = 150 WPM. This is > 180.
      await service.setProgress({
        kidId,
        storyId,
        progress: 100,
        completed: true,
        sessionTime: 120, // 2 minutes
      });

      // Wait for the fire-and-forget logic to run
      await waitForBackgroundTasks();

      // ASSERT
      expect(prisma.kid.update).toHaveBeenCalledWith({
        where: { id: kidId },
        data: { currentReadingLevel: initialLevel + 1 }, // Expect Level 6
      });
    });

    it('should LEVEL DOWN the kid if reading speed is slow (<40 WPM) on a challenging story', async () => {
      // ARRANGE
      prisma.kid.findUnique.mockResolvedValue({
        id: kidId,
        currentReadingLevel: initialLevel,
      });

      // Story is Level 5 (hard enough to judge), 400 words
      prisma.story.findUnique.mockResolvedValue({
        id: storyId,
        difficultyLevel: 5,
        wordCount: 300,
      });

      prisma.storyProgress.findUnique.mockResolvedValue(null);
      prisma.storyProgress.upsert.mockResolvedValue({ id: 'prog-1' } as any);

      // ACT
      // User takes 10 minutes (600 seconds).
      // WPM Calculation: 300 / 10 = 30 WPM. This is < 60.
      await service.setProgress({
        kidId,
        storyId,
        progress: 100,
        completed: true,
        sessionTime: 600,
      });

      await waitForBackgroundTasks();

      // ASSERT
      expect(prisma.kid.update).toHaveBeenCalledWith({
        where: { id: kidId },
        data: { currentReadingLevel: initialLevel - 1 }, // Expect Level 4
      });
    });

    it('should NOT change level if reading speed is normal (e.g. 100 WPM)', async () => {
      // ARRANGE
      prisma.kid.findUnique.mockResolvedValue({
        id: kidId,
        currentReadingLevel: initialLevel,
      });
      prisma.story.findUnique.mockResolvedValue({
        id: storyId,
        difficultyLevel: 5,
        wordCount: 400,
      });
      prisma.storyProgress.findUnique.mockResolvedValue(null);
      prisma.storyProgress.upsert.mockResolvedValue({ id: 'prog-1' } as any);

      // ACT
      // User takes 4 minutes (240 seconds).
      // WPM Calculation: 400 / 4 = 100 WPM.
      await service.setProgress({
        kidId,
        storyId,
        progress: 100,
        completed: true,
        sessionTime: 240,
      });

      await waitForBackgroundTasks();

      // ASSERT
      expect(prisma.kid.update).not.toHaveBeenCalled();
    });

    it('should NOT level up if the story was too easy (Difficulty < Kid Level)', async () => {
      // ARRANGE
      prisma.kid.findUnique.mockResolvedValue({
        id: kidId,
        currentReadingLevel: 5,
      });

      // Story is Difficulty 2 (Too easy for a Level 5 kid)
      prisma.story.findUnique.mockResolvedValue({
        id: storyId,
        difficultyLevel: 2,
        wordCount: 400,
      });

      prisma.storyProgress.findUnique.mockResolvedValue(null);
      prisma.storyProgress.upsert.mockResolvedValue({ id: 'prog-1' } as any);

      // ACT
      // User reads super fast (200 WPM)
      await service.setProgress({
        kidId,
        storyId,
        progress: 100,
        completed: true,
        sessionTime: 120,
      });

      await waitForBackgroundTasks();

      // ASSERT
      // Should not upgrade because they didn't prove themselves on a hard text
      expect(prisma.kid.update).not.toHaveBeenCalled();
    });
  });
});
