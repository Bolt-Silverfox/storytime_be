import { Test, TestingModule } from '@nestjs/testing';
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

const mockStoryRepository = {
  findStories: jest.fn(),
  countStories: jest.fn(),
  findStoryById: jest.fn(),
  createStory: jest.fn(),
  updateStory: jest.fn(),
  deleteStory: jest.fn(),
};

const mockFavoriteService = {
  removeFavorite: jest.fn(),
};

const mockDownloadService = {
  addDownload: jest.fn(),
  deleteDownloadsForStory: jest.fn(),
};

const mockProgressService = {
  deleteStoryProgress: jest.fn(),
};

describe('StoryService - Library', () => {
  let service: StoryService;
  let storyRepository: typeof mockStoryRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryService,
        { provide: STORY_CORE_REPOSITORY, useValue: mockStoryRepository },
        {
          provide: 'CACHE_MANAGER',
          useValue: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
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
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
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
          useValue: { getSeasons: jest.fn(), getCategories: jest.fn(), getThemes: jest.fn() },
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
});
