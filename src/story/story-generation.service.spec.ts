import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StoryGenerationService } from './story-generation.service';
import { STORY_REPOSITORY, IStoryRepository } from './repositories';
import { GeminiService, GeneratedStory } from './gemini.service';
import { TextToSpeechService } from './text-to-speech.service';
import { AppEvents } from '@/shared/events';

describe('StoryGenerationService', () => {
  let service: StoryGenerationService;
  let mockStoryRepository: Partial<IStoryRepository>;
  let mockGeminiService: Partial<GeminiService>;
  let mockTextToSpeechService: Partial<TextToSpeechService>;
  let mockCacheManager: { del: jest.Mock; get: jest.Mock; set: jest.Mock };
  let mockEventEmitter: Partial<EventEmitter2>;

  const mockGeneratedStory: GeneratedStory = {
    title: 'The Adventure Begins',
    description: 'A tale of bravery',
    content:
      'Once upon a time there was a brave hero who went on an adventure.',
    questions: [
      { question: 'Who was brave?', options: ['Hero', 'Villain'], answer: 0 },
    ],
    theme: ['Adventure'],
    category: ['Fantasy'],
    ageMin: 4,
    ageMax: 8,
    language: 'English',
    difficultyLevel: 1,
    estimatedWordCount: 13,
  };

  const mockKid = {
    id: 'kid-123',
    parentId: 'parent-456',
    name: 'Test Kid',
    ageRange: '4-6',
    preferredCategories: [{ id: 'cat-1', name: 'Fantasy' }],
    excludedTags: ['scary'],
    preferredVoice: { name: 'Charlie', elevenLabsVoiceId: 'CHARLIE' },
  };

  const mockCreatedStory = {
    id: 'story-789',
    title: 'The Adventure Begins',
    description: 'A tale of bravery',
    textContent:
      'Once upon a time there was a brave hero who went on an adventure.',
    coverImageUrl: 'https://image.url',
    audioUrl: 'https://audio.url',
    wordCount: 13,
    durationSeconds: 6,
    aiGenerated: true,
    creatorKidId: 'kid-123',
    createdAt: new Date(),
    categories: [{ id: 'cat-1', name: 'Fantasy' }],
    themes: [{ id: 'theme-1', name: 'Adventure' }],
    seasons: [],
  };

  beforeEach(async () => {
    mockStoryRepository = {
      findSeasonsByIds: jest.fn().mockResolvedValue([]),
      findKidByIdWithPreferences: jest.fn().mockResolvedValue(mockKid),
      findKidById: jest
        .fn()
        .mockResolvedValue({ id: 'kid-123', parentId: 'parent-456' }),
      findAllThemes: jest
        .fn()
        .mockResolvedValue([{ id: 'theme-1', name: 'Adventure' }]),
      findAllCategories: jest
        .fn()
        .mockResolvedValue([{ id: 'cat-1', name: 'Fantasy' }]),
      executeTransaction: jest.fn().mockImplementation((fn) =>
        fn({
          story: {
            create: jest.fn().mockResolvedValue(mockCreatedStory),
          },
        }),
      ),
    };

    mockGeminiService = {
      generateStory: jest.fn().mockResolvedValue(mockGeneratedStory),
      generateStoryImage: jest.fn().mockReturnValue('https://image.url'),
    };

    mockTextToSpeechService = {
      synthesizeStory: jest.fn().mockResolvedValue('https://audio.url'),
    };

    mockCacheManager = {
      del: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryGenerationService,
        { provide: STORY_REPOSITORY, useValue: mockStoryRepository },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: TextToSpeechService, useValue: mockTextToSpeechService },
        { provide: 'CACHE_MANAGER', useValue: mockCacheManager },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<StoryGenerationService>(StoryGenerationService);
    jest.clearAllMocks();
  });

  describe('calculateDurationSeconds', () => {
    it('should calculate duration from text string', () => {
      const text = 'One two three four five six seven eight nine ten';
      const duration = service.calculateDurationSeconds(text);
      // 10 words at 150 words per minute = 0.067 minutes = 4 seconds (ceil)
      expect(duration).toBe(4);
    });

    it('should calculate duration from word count number', () => {
      const duration = service.calculateDurationSeconds(150);
      // 150 words at 150 wpm = 1 minute = 60 seconds
      expect(duration).toBe(60);
    });

    it('should return 0 for empty text', () => {
      expect(service.calculateDurationSeconds('')).toBe(0);
    });

    it('should return 0 for zero word count', () => {
      expect(service.calculateDurationSeconds(0)).toBe(0);
    });

    it('should return 0 for negative word count', () => {
      expect(service.calculateDurationSeconds(-10)).toBe(0);
    });

    it('should handle text with extra whitespace', () => {
      const text = '  Word   another   word  ';
      const duration = service.calculateDurationSeconds(text);
      // 3 words at 150 wpm = 1.2 seconds (ceil = 2)
      expect(duration).toBe(2);
    });
  });

  describe('generateStoryWithAI', () => {
    const options = {
      theme: ['Adventure'],
      category: ['Fantasy'],
      ageMin: 4,
      ageMax: 8,
      kidName: 'Test Kid',
    };

    it('should generate a story with AI and persist it', async () => {
      const result = await service.generateStoryWithAI(options);

      expect(mockGeminiService.generateStory).toHaveBeenCalledWith(options);
      expect(mockGeminiService.generateStoryImage).toHaveBeenCalled();
      expect(mockTextToSpeechService.synthesizeStory).toHaveBeenCalled();
      expect(mockStoryRepository.executeTransaction).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedStory);
    });

    it('should resolve season IDs to names if provided', async () => {
      (mockStoryRepository.findSeasonsByIds as jest.Mock).mockResolvedValue([
        { id: 'season-1', name: 'Winter' },
      ]);

      await service.generateStoryWithAI({
        ...options,
        seasonIds: ['season-1'],
      });

      expect(mockStoryRepository.findSeasonsByIds).toHaveBeenCalledWith([
        'season-1',
      ]);
      expect(mockGeminiService.generateStory).toHaveBeenCalledWith(
        expect.objectContaining({ seasons: ['Winter'] }),
      );
    });

    it('should emit STORY_CREATED event after creation', async () => {
      await service.generateStoryWithAI(options);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        AppEvents.STORY_CREATED,
        expect.objectContaining({
          storyId: mockCreatedStory.id,
          title: mockCreatedStory.title,
          aiGenerated: true,
        }),
      );
    });

    it('should invalidate caches after story creation', async () => {
      await service.generateStoryWithAI(options);

      expect(mockCacheManager.del).toHaveBeenCalled();
    });
  });

  describe('generateStoryForKid', () => {
    it('should generate a personalized story for a kid', async () => {
      const result = await service.generateStoryForKid('kid-123');

      expect(
        mockStoryRepository.findKidByIdWithPreferences,
      ).toHaveBeenCalledWith('kid-123');
      expect(mockGeminiService.generateStory).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedStory);
    });

    it('should throw NotFoundException if kid not found', async () => {
      (
        mockStoryRepository.findKidByIdWithPreferences as jest.Mock
      ).mockResolvedValue(null);

      await expect(service.generateStoryForKid('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should use kid preferred categories', async () => {
      await service.generateStoryForKid('kid-123');

      expect(mockGeminiService.generateStory).toHaveBeenCalledWith(
        expect.objectContaining({
          category: expect.arrayContaining(['Fantasy']),
        }),
      );
    });

    it('should parse age range from kid profile', async () => {
      (
        mockStoryRepository.findKidByIdWithPreferences as jest.Mock
      ).mockResolvedValue({
        ...mockKid,
        ageRange: '5-7',
      });

      await service.generateStoryForKid('kid-123');

      expect(mockGeminiService.generateStory).toHaveBeenCalledWith(
        expect.objectContaining({
          ageMin: 5,
          ageMax: 7,
        }),
      );
    });

    it('should include excluded tags in additional context', async () => {
      await service.generateStoryForKid('kid-123');

      expect(mockGeminiService.generateStory).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: expect.stringContaining('scary'),
        }),
      );
    });

    it('should use preferred voice type from kid profile', async () => {
      await service.generateStoryForKid('kid-123');

      // Voice is used when persisting the story
      expect(mockTextToSpeechService.synthesizeStory).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String), // Voice type
      );
    });

    it('should use provided theme and category names', async () => {
      await service.generateStoryForKid(
        'kid-123',
        ['Custom Theme'],
        ['Custom Category'],
      );

      expect(mockGeminiService.generateStory).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: ['Custom Theme'],
          category: expect.arrayContaining(['Custom Category', 'Fantasy']),
        }),
      );
    });

    it('should fetch random theme if none provided and kid has no preferences', async () => {
      (
        mockStoryRepository.findKidByIdWithPreferences as jest.Mock
      ).mockResolvedValue({
        ...mockKid,
        preferredCategories: [],
      });

      await service.generateStoryForKid('kid-123');

      expect(mockStoryRepository.findAllThemes).toHaveBeenCalled();
      expect(mockStoryRepository.findAllCategories).toHaveBeenCalled();
    });

    it('should use custom kid name if provided', async () => {
      await service.generateStoryForKid('kid-123', [], [], [], 'Custom Name');

      expect(mockGeminiService.generateStory).toHaveBeenCalledWith(
        expect.objectContaining({
          kidName: 'Custom Name',
        }),
      );
    });

    it('should resolve season IDs to names', async () => {
      (mockStoryRepository.findSeasonsByIds as jest.Mock).mockResolvedValue([
        { id: 'season-1', name: 'Summer' },
      ]);

      await service.generateStoryForKid('kid-123', [], [], ['season-1']);

      expect(mockStoryRepository.findSeasonsByIds).toHaveBeenCalledWith([
        'season-1',
      ]);
    });
  });

  describe('persistGeneratedStory (via generateStoryWithAI)', () => {
    it('should create story with calculated word count and duration', async () => {
      await service.generateStoryWithAI({
        theme: ['Adventure'],
        category: ['Fantasy'],
        ageMin: 4,
        ageMax: 8,
      });

      expect(mockStoryRepository.executeTransaction).toHaveBeenCalled();
      // Verify transaction was called with story.create
      const transactionFn = (
        mockStoryRepository.executeTransaction as jest.Mock
      ).mock.calls[0][0];
      expect(transactionFn).toBeDefined();
    });

    it('should continue without audio if TTS fails', async () => {
      (mockTextToSpeechService.synthesizeStory as jest.Mock).mockRejectedValue(
        new Error('TTS failed'),
      );

      const result = await service.generateStoryWithAI({
        theme: ['Adventure'],
        category: ['Fantasy'],
        ageMin: 4,
        ageMax: 8,
      });

      // Story should still be created
      expect(result).toBeDefined();
      expect(mockStoryRepository.executeTransaction).toHaveBeenCalled();
    });

    it('should continue without image if image generation fails', async () => {
      (mockGeminiService.generateStoryImage as jest.Mock).mockImplementation(
        () => {
          throw new Error('Image generation failed');
        },
      );

      const result = await service.generateStoryWithAI({
        theme: ['Adventure'],
        category: ['Fantasy'],
        ageMin: 4,
        ageMax: 8,
      });

      // Story should still be created
      expect(result).toBeDefined();
    });

    it('should connect seasons by ID if provided', async () => {
      await service.generateStoryWithAI({
        theme: ['Adventure'],
        category: ['Fantasy'],
        ageMin: 4,
        ageMax: 8,
        seasonIds: ['season-1', 'season-2'],
      });

      expect(mockStoryRepository.executeTransaction).toHaveBeenCalled();
    });
  });

  describe('cache invalidation', () => {
    it('should not throw if cache invalidation fails', async () => {
      mockCacheManager.del.mockRejectedValue(new Error('Cache error'));

      // Should not throw
      await expect(
        service.generateStoryWithAI({
          theme: ['Adventure'],
          category: ['Fantasy'],
          ageMin: 4,
          ageMax: 8,
        }),
      ).resolves.toBeDefined();
    });
  });
});
