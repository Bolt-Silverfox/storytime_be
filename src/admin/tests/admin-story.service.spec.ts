import { Test, TestingModule } from '@nestjs/testing';
import { ResourceNotFoundException } from '@/shared/exceptions';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminStoryService } from '../admin-story.service';
import {
  ADMIN_STORY_REPOSITORY,
  IAdminStoryRepository,
} from '../repositories/admin-story.repository.interface';

describe('AdminStoryService', () => {
  let service: AdminStoryService;
  let adminStoryRepository: jest.Mocked<IAdminStoryRepository>;
  let mockCacheManager: {
    del: jest.Mock;
  };

  const mockStory = {
    id: 'story-123',
    title: 'Test Story',
    description: 'A test story description',
    content: 'Once upon a time...',
    duration: 300,
    language: 'en',
    ageMin: 4,
    ageMax: 8,
    recommended: false,
    aiGenerated: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    categories: [{ id: 'cat-1', name: 'Adventure' }],
    themes: [{ id: 'theme-1', name: 'Friendship' }],
    _count: {
      favorites: 10,
      progresses: 50,
      parentFavorites: 5,
      downloads: 20,
    },
  };

  const mockStoryWithFullRelations = {
    ...mockStory,
    images: [{ id: 'img-1', url: 'https://example.com/image.jpg' }],
    branches: [{ id: 'branch-1', content: 'Branch content' }],
    questions: [{ id: 'q-1', question: 'What happened?' }],
  };

  const mockCategory = {
    id: 'cat-1',
    name: 'Adventure',
    image: 'https://example.com/adventure.jpg',
    description: 'Adventure stories',
    isDeleted: false,
    deletedAt: null,
    _count: {
      stories: 15,
      preferredByKids: 8,
    },
  };

  beforeEach(async () => {
    const mockAdminStoryRepository = {
      findStories: jest.fn(),
      countStories: jest.fn(),
      findStoryById: jest.fn(),
      updateStory: jest.fn(),
      deleteStory: jest.fn(),
      findCategories: jest.fn(),
      findThemes: jest.fn(),
    };

    mockCacheManager = {
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStoryService,
        {
          provide: ADMIN_STORY_REPOSITORY,
          useValue: mockAdminStoryRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<AdminStoryService>(AdminStoryService);
    adminStoryRepository = module.get(ADMIN_STORY_REPOSITORY);
    jest.clearAllMocks();
  });

  describe('getAllStories', () => {
    it('should return paginated stories', async () => {
      adminStoryRepository.findStories.mockResolvedValue([mockStory as any]);
      adminStoryRepository.countStories.mockResolvedValue(1);

      const result = await service.getAllStories({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(adminStoryRepository.findStories).toHaveBeenCalled();
    });
  });

  describe('getStoryById', () => {
    it('should return story details', async () => {
      adminStoryRepository.findStoryById.mockResolvedValue(
        mockStoryWithFullRelations as any,
      );

      const result = await service.getStoryById('story-123');

      expect(result.id).toBe('story-123');
      expect(result.stats).toBeDefined();
    });

    it('should throw NotFoundException if story not found', async () => {
      adminStoryRepository.findStoryById.mockResolvedValue(null);

      await expect(service.getStoryById('nonexistent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  describe('getCategories', () => {
    it('should return categories', async () => {
      adminStoryRepository.findCategories.mockResolvedValue([
        mockCategory as any,
      ]);

      const result = await service.getCategories();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Adventure');
    });
  });
});
