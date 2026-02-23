import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StoryService } from './story.service';
import { UploadService } from '../upload/upload.service';
import { TextToSpeechService } from './text-to-speech.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StoryFavoriteService } from './story-favorite.service';
import { StoryDownloadService } from './story-download.service';
import { StoryProgressService } from './story-progress.service';
import { StoryPathService } from './story-path.service';
import { StoryMetadataService } from './story-metadata.service';
import { DailyChallengeService } from './daily-challenge.service';
import { STORY_CORE_REPOSITORY } from './repositories/story-core.repository.interface';
import { AppEvents } from '@/shared/events';

const mockStoryRepository = {
  findStories: jest.fn(),
  countStories: jest.fn(),
  findStoryById: jest.fn(),
  createStory: jest.fn(),
  updateStory: jest.fn(),
  deleteStory: jest.fn(),
  softDeleteStory: jest.fn(),
  deleteStoryPermanently: jest.fn(),
  restoreStory: jest.fn(),
  restrictStory: jest.fn(),
  unrestrictStory: jest.fn(),
  findRestrictedStories: jest.fn(),
};

const mockFavoriteService = {
  addFavorite: jest.fn(),
  removeFavorite: jest.fn(),
  getFavorites: jest.fn(),
};

const mockDownloadService = {
  addDownload: jest.fn(),
  getDownloads: jest.fn(),
  removeDownload: jest.fn(),
  deleteDownloadsForStory: jest.fn(),
};

const mockProgressService = {
  setProgress: jest.fn(),
  getProgress: jest.fn(),
  getCompletedStories: jest.fn(),
  getContinueReading: jest.fn(),
  deleteStoryProgress: jest.fn(),
};

const mockTextToSpeechService = {
  textToSpeechCloudUrl: jest.fn().mockResolvedValue('http://audio.url'),
  synthesizeStory: jest.fn().mockResolvedValue('http://synthesized.url'),
};

const mockMetadataService = {
  getSeasons: jest.fn(),
  getCategories: jest.fn(),
  getThemes: jest.fn(),
  addImage: jest.fn(),
  addBranch: jest.fn(),
};

const mockCacheManager = {
  del: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('StoryService', () => {
  let service: StoryService;
  let storyRepository: typeof mockStoryRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryService,
        { provide: STORY_CORE_REPOSITORY, useValue: mockStoryRepository },
        {
          provide: 'CACHE_MANAGER',
          useValue: mockCacheManager,
        },
        {
          provide: UploadService,
          useValue: { uploadAudioBuffer: jest.fn().mockResolvedValue('url') },
        },
        {
          provide: TextToSpeechService,
          useValue: mockTextToSpeechService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        { provide: StoryFavoriteService, useValue: mockFavoriteService },
        { provide: StoryDownloadService, useValue: mockDownloadService },
        { provide: StoryProgressService, useValue: mockProgressService },
        {
          provide: StoryPathService,
          useValue: {},
        },
        {
          provide: StoryMetadataService,
          useValue: mockMetadataService,
        },
        {
          provide: DailyChallengeService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<StoryService>(StoryService);
    storyRepository = module.get(STORY_CORE_REPOSITORY);
    jest.clearAllMocks();
  });

  describe('Library Methods', () => {
    describe('getStories', () => {
      it('should filter by minAge and maxAge', async () => {
        storyRepository.findStories.mockResolvedValue([]);
        storyRepository.countStories.mockResolvedValue(0);

        await service.getStories({ minAge: 3, maxAge: 5 });

        expect(storyRepository.findStories).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              minAge: { gte: 3 },
              maxAge: { lte: 5 },
            }),
          }),
        );
      });

      it('should filter by minAge only', async () => {
        storyRepository.findStories.mockResolvedValue([]);
        storyRepository.countStories.mockResolvedValue(0);

        await service.getStories({ minAge: 4 });

        expect(storyRepository.findStories).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              minAge: { gte: 4 },
            }),
          }),
        );
      });

      it('should filter by maxAge only', async () => {
        storyRepository.findStories.mockResolvedValue([]);
        storyRepository.countStories.mockResolvedValue(0);

        await service.getStories({ maxAge: 8 });

        expect(storyRepository.findStories).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              isDeleted: false,
              maxAge: { lte: 8 },
            }),
          }),
        );
      });
    });

    const kidId = 'kid-123';

    it('getCreatedStories: should filter by creatorKidId', async () => {
      storyRepository.findStories.mockResolvedValue([]);

      await service.getCreatedStories(kidId);

      expect(storyRepository.findStories).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            creatorKidId: kidId,
            isDeleted: false,
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('addDownload: should delegate to downloadService', async () => {
      const storyId = 'story-456';
      mockDownloadService.addDownload.mockResolvedValue({ kidId, storyId });

      await service.addDownload(kidId, storyId);

      expect(mockDownloadService.addDownload).toHaveBeenCalledWith(
        kidId,
        storyId,
      );
    });

    it('removeFromLibrary: should delegate to favorite, download, and progress services', async () => {
      const storyId = 'story-456';
      mockFavoriteService.removeFavorite.mockResolvedValue(undefined);
      mockDownloadService.deleteDownloadsForStory.mockResolvedValue(undefined);
      mockProgressService.deleteStoryProgress.mockResolvedValue(undefined);

      await service.removeFromLibrary(kidId, storyId);

      expect(mockFavoriteService.removeFavorite).toHaveBeenCalledWith(
        kidId,
        storyId,
      );
      expect(mockDownloadService.deleteDownloadsForStory).toHaveBeenCalledWith(
        kidId,
        storyId,
      );
      expect(mockProgressService.deleteStoryProgress).toHaveBeenCalledWith(
        kidId,
        storyId,
      );
    });
  });

  describe('getStoryById', () => {
    it('should return the story when found', async () => {
      const mockStory = { id: 'story-1', title: 'Test Story' };
      mockStoryRepository.findStoryById.mockResolvedValue(mockStory);

      const result = await service.getStoryById('story-1');

      expect(result).toEqual(mockStory);
      expect(mockStoryRepository.findStoryById).toHaveBeenCalledWith('story-1');
    });

    it('should throw NotFoundException when story does not exist', async () => {
      mockStoryRepository.findStoryById.mockResolvedValue(null);

      await expect(service.getStoryById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStoryRepository.findStoryById).toHaveBeenCalledWith(
        'nonexistent',
      );
    });
  });

  describe('createStory', () => {
    const createDto = {
      title: 'New Story',
      description: 'A great story',
      textContent: 'Once upon a time...',
    };

    const mockCreatedStory = {
      id: 'story-new',
      title: 'New Story',
      description: 'A great story',
      textContent: 'Once upon a time...',
      creatorKidId: null,
      createdAt: new Date('2026-01-01'),
    };

    it('should create a story and return it', async () => {
      mockStoryRepository.createStory.mockResolvedValue(mockCreatedStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      const result = await service.createStory(createDto as any);

      expect(result).toEqual(mockCreatedStory);
      expect(mockStoryRepository.createStory).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Story' }),
        { images: true },
      );
    });

    it('should emit a STORY_CREATED event', async () => {
      mockStoryRepository.createStory.mockResolvedValue(mockCreatedStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.createStory(createDto as any);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        AppEvents.STORY_CREATED,
        expect.objectContaining({
          storyId: 'story-new',
          title: 'New Story',
          aiGenerated: false,
        }),
      );
    });

    it('should invalidate story caches after creation', async () => {
      mockStoryRepository.createStory.mockResolvedValue(mockCreatedStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.createStory(createDto as any);

      expect(mockCacheManager.del).toHaveBeenCalled();
    });

    it('should connect categories when categoryIds are provided', async () => {
      const dtoWithCategories = {
        ...createDto,
        categoryIds: ['cat-1', 'cat-2'],
      };
      mockStoryRepository.createStory.mockResolvedValue(mockCreatedStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.createStory(dtoWithCategories as any);

      expect(mockStoryRepository.createStory).toHaveBeenCalledWith(
        expect.objectContaining({
          categories: { connect: [{ id: 'cat-1' }, { id: 'cat-2' }] },
        }),
        { images: true },
      );
    });

    it('should connect themes when themeIds are provided', async () => {
      const dtoWithThemes = {
        ...createDto,
        themeIds: ['theme-1'],
      };
      mockStoryRepository.createStory.mockResolvedValue(mockCreatedStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.createStory(dtoWithThemes as any);

      expect(mockStoryRepository.createStory).toHaveBeenCalledWith(
        expect.objectContaining({
          themes: { connect: [{ id: 'theme-1' }] },
        }),
        { images: true },
      );
    });
  });

  describe('updateStory', () => {
    it('should update and return the story', async () => {
      const updatedStory = { id: 'story-1', title: 'Updated Title' };
      mockStoryRepository.updateStory.mockResolvedValue(updatedStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      const result = await service.updateStory('story-1', {
        title: 'Updated Title',
      } as any);

      expect(result).toEqual(updatedStory);
      expect(mockStoryRepository.updateStory).toHaveBeenCalledWith(
        'story-1',
        expect.objectContaining({ title: 'Updated Title' }),
        { images: true },
      );
    });

    it('should invalidate story caches after update', async () => {
      mockStoryRepository.updateStory.mockResolvedValue({ id: 'story-1' });
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.updateStory('story-1', { title: 'New' } as any);

      expect(mockCacheManager.del).toHaveBeenCalled();
    });
  });

  describe('deleteStory', () => {
    it('should soft delete by default', async () => {
      const deletedStory = { id: 'story-1', isDeleted: true };
      mockStoryRepository.softDeleteStory.mockResolvedValue(deletedStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      const result = await service.deleteStory('story-1');

      expect(result).toEqual(deletedStory);
      expect(mockStoryRepository.softDeleteStory).toHaveBeenCalledWith(
        'story-1',
      );
      expect(mockStoryRepository.deleteStoryPermanently).not.toHaveBeenCalled();
    });

    it('should permanently delete when permanent=true', async () => {
      const deletedStory = { id: 'story-1' };
      mockStoryRepository.deleteStoryPermanently.mockResolvedValue(
        deletedStory,
      );
      mockCacheManager.del.mockResolvedValue(undefined);

      const result = await service.deleteStory('story-1', true);

      expect(result).toEqual(deletedStory);
      expect(mockStoryRepository.deleteStoryPermanently).toHaveBeenCalledWith(
        'story-1',
      );
      expect(mockStoryRepository.softDeleteStory).not.toHaveBeenCalled();
    });

    it('should invalidate story caches after deletion', async () => {
      mockStoryRepository.softDeleteStory.mockResolvedValue({ id: 'story-1' });
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.deleteStory('story-1');

      expect(mockCacheManager.del).toHaveBeenCalled();
    });
  });

  describe('getStoryAudioUrl', () => {
    it('should return audio URL from TTS service for existing story', async () => {
      const mockStory = {
        id: 'story-1',
        textContent: 'Once upon a time...',
        description: 'A fairy tale',
      };
      mockStoryRepository.findStoryById.mockResolvedValue(mockStory);
      mockTextToSpeechService.synthesizeStory.mockResolvedValue(
        'http://audio.example.com/story-1.mp3',
      );

      const result = await service.getStoryAudioUrl('story-1', 'charlie');

      expect(result).toBe('http://audio.example.com/story-1.mp3');
      expect(mockTextToSpeechService.synthesizeStory).toHaveBeenCalledWith(
        'story-1',
        'Once upon a time...',
        'charlie',
        undefined,
      );
    });

    it('should fall back to description when textContent is empty', async () => {
      const mockStory = {
        id: 'story-2',
        textContent: '',
        description: 'Fallback description',
      };
      mockStoryRepository.findStoryById.mockResolvedValue(mockStory);
      mockTextToSpeechService.synthesizeStory.mockResolvedValue(
        'http://audio.example.com/story-2.mp3',
      );

      await service.getStoryAudioUrl('story-2', 'charlie');

      expect(mockTextToSpeechService.synthesizeStory).toHaveBeenCalledWith(
        'story-2',
        'Fallback description',
        'charlie',
        undefined,
      );
    });

    it('should throw NotFoundException when story does not exist', async () => {
      mockStoryRepository.findStoryById.mockResolvedValue(null);

      await expect(
        service.getStoryAudioUrl('nonexistent', 'charlie'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should pass userId to TTS service when provided', async () => {
      const mockStory = {
        id: 'story-1',
        textContent: 'Text',
        description: '',
      };
      mockStoryRepository.findStoryById.mockResolvedValue(mockStory);
      mockTextToSpeechService.synthesizeStory.mockResolvedValue('http://url');

      await service.getStoryAudioUrl('story-1', 'charlie', 'user-42');

      expect(mockTextToSpeechService.synthesizeStory).toHaveBeenCalledWith(
        'story-1',
        'Text',
        'charlie',
        'user-42',
      );
    });
  });

  describe('Favorites (delegated to StoryFavoriteService)', () => {
    it('addFavorite: should delegate to favoriteService', async () => {
      const dto = { kidId: 'kid-1', storyId: 'story-1' };
      const mockResult = { id: 'fav-1', ...dto };
      mockFavoriteService.addFavorite.mockResolvedValue(mockResult);

      const result = await service.addFavorite(dto as any);

      expect(result).toEqual(mockResult);
      expect(mockFavoriteService.addFavorite).toHaveBeenCalledWith(dto);
    });

    it('removeFavorite: should delegate to favoriteService', async () => {
      mockFavoriteService.removeFavorite.mockResolvedValue(undefined);

      await service.removeFavorite('kid-1', 'story-1');

      expect(mockFavoriteService.removeFavorite).toHaveBeenCalledWith(
        'kid-1',
        'story-1',
      );
    });

    it('getFavorites: should delegate to favoriteService', async () => {
      const mockFavorites = [
        { id: 'fav-1', storyId: 'story-1' },
        { id: 'fav-2', storyId: 'story-2' },
      ];
      mockFavoriteService.getFavorites.mockResolvedValue(mockFavorites);

      const result = await service.getFavorites('kid-1');

      expect(result).toEqual(mockFavorites);
      expect(mockFavoriteService.getFavorites).toHaveBeenCalledWith('kid-1');
    });
  });

  describe('Progress (delegated to StoryProgressService)', () => {
    it('setProgress: should delegate to progressService', async () => {
      const dto = {
        kidId: 'kid-1',
        storyId: 'story-1',
        progress: 50,
        sessionTime: 120,
      };
      const mockResult = { id: 'prog-1', ...dto };
      mockProgressService.setProgress.mockResolvedValue(mockResult);

      const result = await service.setProgress(dto as any);

      expect(result).toEqual(mockResult);
      expect(mockProgressService.setProgress).toHaveBeenCalledWith(dto);
    });

    it('getProgress: should delegate to progressService', async () => {
      const mockResult = { progress: 75, storyId: 'story-1' };
      mockProgressService.getProgress.mockResolvedValue(mockResult);

      const result = await service.getProgress('kid-1', 'story-1');

      expect(result).toEqual(mockResult);
      expect(mockProgressService.getProgress).toHaveBeenCalledWith(
        'kid-1',
        'story-1',
      );
    });

    it('getCompletedStories: should delegate to progressService', async () => {
      const mockCompleted = [{ storyId: 'story-1', completedAt: new Date() }];
      mockProgressService.getCompletedStories.mockResolvedValue(mockCompleted);

      const result = await service.getCompletedStories('kid-1');

      expect(result).toEqual(mockCompleted);
      expect(mockProgressService.getCompletedStories).toHaveBeenCalledWith(
        'kid-1',
      );
    });

    it('getContinueReading: should delegate to progressService', async () => {
      const mockReading = [{ storyId: 'story-2', progress: 30 }];
      mockProgressService.getContinueReading.mockResolvedValue(mockReading);

      const result = await service.getContinueReading('kid-1');

      expect(result).toEqual(mockReading);
      expect(mockProgressService.getContinueReading).toHaveBeenCalledWith(
        'kid-1',
      );
    });
  });

  describe('Metadata (delegated to StoryMetadataService)', () => {
    it('getCategories: should delegate to metadataService', async () => {
      const mockCategories = [
        { id: 'cat-1', name: 'Adventure' },
        { id: 'cat-2', name: 'Fantasy' },
      ];
      mockMetadataService.getCategories.mockResolvedValue(mockCategories);

      const result = await service.getCategories();

      expect(result).toEqual(mockCategories);
      expect(mockMetadataService.getCategories).toHaveBeenCalled();
    });

    it('getThemes: should delegate to metadataService', async () => {
      const mockThemes = [
        { id: 'theme-1', name: 'Friendship' },
        { id: 'theme-2', name: 'Courage' },
      ];
      mockMetadataService.getThemes.mockResolvedValue(mockThemes);

      const result = await service.getThemes();

      expect(result).toEqual(mockThemes);
      expect(mockMetadataService.getThemes).toHaveBeenCalled();
    });

    it('getSeasons: should delegate to metadataService', async () => {
      const mockSeasons = [
        { id: 'season-1', name: 'Winter' },
        { id: 'season-2', name: 'Summer' },
      ];
      mockMetadataService.getSeasons.mockResolvedValue(mockSeasons);

      const result = await service.getSeasons();

      expect(result).toEqual(mockSeasons);
      expect(mockMetadataService.getSeasons).toHaveBeenCalled();
    });
  });

  describe('undoDeleteStory', () => {
    it('should restore a soft-deleted story', async () => {
      const restoredStory = { id: 'story-1', isDeleted: false };
      mockStoryRepository.restoreStory.mockResolvedValue(restoredStory);
      mockCacheManager.del.mockResolvedValue(undefined);

      const result = await service.undoDeleteStory('story-1');

      expect(result).toEqual(restoredStory);
      expect(mockStoryRepository.restoreStory).toHaveBeenCalledWith('story-1');
    });

    it('should invalidate caches after restoring', async () => {
      mockStoryRepository.restoreStory.mockResolvedValue({ id: 'story-1' });
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.undoDeleteStory('story-1');

      expect(mockCacheManager.del).toHaveBeenCalled();
    });
  });
});
