import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminStoryService } from '../admin-story.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AdminStoryService', () => {
  let service: AdminStoryService;
  let mockPrisma: {
    story: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    category: {
      findMany: jest.Mock;
    };
    theme: {
      findMany: jest.Mock;
    };
  };
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

  const mockTheme = {
    id: 'theme-1',
    name: 'Friendship',
    image: 'https://example.com/friendship.jpg',
    description: 'Stories about friendship',
    isDeleted: false,
    deletedAt: null,
    _count: {
      stories: 20,
    },
  };

  beforeEach(async () => {
    mockPrisma = {
      story: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      category: {
        findMany: jest.fn(),
      },
      theme: {
        findMany: jest.fn(),
      },
    };

    mockCacheManager = {
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStoryService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<AdminStoryService>(AdminStoryService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllStories', () => {
    it('should return paginated stories with default filters', async () => {
      mockPrisma.story.findMany.mockResolvedValue([mockStory]);
      mockPrisma.story.count.mockResolvedValue(1);

      const result = await service.getAllStories({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockPrisma.story.findMany).toHaveBeenCalled();
      expect(mockPrisma.story.count).toHaveBeenCalled();
    });

    it('should apply search filter', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ search: 'adventure' });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: 'adventure', mode: 'insensitive' } },
              { description: { contains: 'adventure', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should filter by recommended status', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ recommended: true });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            recommended: true,
          }),
        }),
      );
    });

    it('should filter by AI generated status', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ aiGenerated: false });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            aiGenerated: false,
          }),
        }),
      );
    });

    it('should filter by deletion status', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ isDeleted: false });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDeleted: false,
          }),
        }),
      );
    });

    it('should filter by language', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ language: 'en' });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            language: 'en',
          }),
        }),
      );
    });

    it('should filter by minimum age', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ minAge: 4 });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ageMin: { gte: 4 },
          }),
        }),
      );
    });

    it('should filter by maximum age', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ maxAge: 8 });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ageMax: { lte: 8 },
          }),
        }),
      );
    });

    it('should calculate counts correctly in response', async () => {
      mockPrisma.story.findMany.mockResolvedValue([mockStory]);
      mockPrisma.story.count.mockResolvedValue(1);

      const result = await service.getAllStories({});

      expect(result.data[0].favoritesCount).toBe(10);
      expect(result.data[0].viewsCount).toBe(50);
      expect(result.data[0].parentFavoritesCount).toBe(5);
      expect(result.data[0].downloadsCount).toBe(20);
    });

    it('should handle pagination correctly', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(50);

      const result = await service.getAllStories({ page: 3, limit: 10 });

      expect(result.meta.totalPages).toBe(5);
      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });

    it('should apply sorting', async () => {
      mockPrisma.story.findMany.mockResolvedValue([]);
      mockPrisma.story.count.mockResolvedValue(0);

      await service.getAllStories({ sortBy: 'title', sortOrder: 'asc' });

      expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { title: 'asc' },
        }),
      );
    });
  });

  describe('getStoryById', () => {
    it('should return story with stats', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStoryWithFullRelations);

      const result = await service.getStoryById('story-123');

      expect(result.id).toBe('story-123');
      expect(result.title).toBe('Test Story');
      expect(result.stats).toEqual({
        favoritesCount: 10,
        viewsCount: 50,
        parentFavoritesCount: 5,
        downloadsCount: 20,
      });
    });

    it('should include images, branches, and questions', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStoryWithFullRelations);

      const result = await service.getStoryById('story-123');

      expect(result.images).toHaveLength(1);
      expect(result.branches).toHaveLength(1);
      expect(result.questions).toHaveLength(1);
    });

    it('should throw NotFoundException if story not found', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(null);

      await expect(service.getStoryById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getStoryById('nonexistent')).rejects.toThrow(
        'Story with ID nonexistent not found',
      );
    });
  });

  describe('toggleStoryRecommendation', () => {
    it('should toggle recommendation from false to true', async () => {
      const unrecommendedStory = { ...mockStory, recommended: false };
      mockPrisma.story.findUnique.mockResolvedValue(unrecommendedStory);
      mockPrisma.story.update.mockResolvedValue({
        ...unrecommendedStory,
        recommended: true,
      });

      const result = await service.toggleStoryRecommendation('story-123');

      expect(result.recommended).toBe(true);
      expect(mockPrisma.story.update).toHaveBeenCalledWith({
        where: { id: 'story-123' },
        data: { recommended: true },
      });
    });

    it('should toggle recommendation from true to false', async () => {
      const recommendedStory = { ...mockStory, recommended: true };
      mockPrisma.story.findUnique.mockResolvedValue(recommendedStory);
      mockPrisma.story.update.mockResolvedValue({
        ...recommendedStory,
        recommended: false,
      });

      const result = await service.toggleStoryRecommendation('story-123');

      expect(result.recommended).toBe(false);
      expect(mockPrisma.story.update).toHaveBeenCalledWith({
        where: { id: 'story-123' },
        data: { recommended: false },
      });
    });

    it('should invalidate cache after toggling', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStory);
      mockPrisma.story.update.mockResolvedValue({
        ...mockStory,
        recommended: true,
      });

      await service.toggleStoryRecommendation('story-123');

      expect(mockCacheManager.del).toHaveBeenCalled();
    });

    it('should throw NotFoundException if story not found', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(null);

      await expect(
        service.toggleStoryRecommendation('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should continue if cache invalidation fails', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStory);
      mockPrisma.story.update.mockResolvedValue({
        ...mockStory,
        recommended: true,
      });
      mockCacheManager.del.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      const result = await service.toggleStoryRecommendation('story-123');
      expect(result.recommended).toBe(true);
    });
  });

  describe('deleteStory', () => {
    it('should soft delete story by default', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStory);
      mockPrisma.story.update.mockResolvedValue({
        ...mockStory,
        isDeleted: true,
        deletedAt: new Date(),
      });

      const result = await service.deleteStory('story-123');

      expect(result.isDeleted).toBe(true);
      expect(mockPrisma.story.update).toHaveBeenCalledWith({
        where: { id: 'story-123' },
        data: {
          isDeleted: true,
          deletedAt: expect.any(Date),
        },
      });
    });

    it('should permanently delete story when permanent is true', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStory);
      mockPrisma.story.delete.mockResolvedValue(mockStory);

      await service.deleteStory('story-123', true);

      expect(mockPrisma.story.delete).toHaveBeenCalledWith({
        where: { id: 'story-123' },
      });
    });

    it('should invalidate caches after deletion', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStory);
      mockPrisma.story.update.mockResolvedValue({
        ...mockStory,
        isDeleted: true,
      });

      await service.deleteStory('story-123');

      // Should have called del for each story invalidation key
      expect(mockCacheManager.del).toHaveBeenCalled();
    });

    it('should throw NotFoundException if story not found', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(null);

      await expect(service.deleteStory('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteStory('nonexistent')).rejects.toThrow(
        'Story with ID nonexistent not found',
      );
    });

    it('should continue if cache invalidation fails', async () => {
      mockPrisma.story.findUnique.mockResolvedValue(mockStory);
      mockPrisma.story.update.mockResolvedValue({
        ...mockStory,
        isDeleted: true,
      });
      mockCacheManager.del.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      const result = await service.deleteStory('story-123');
      expect(result.isDeleted).toBe(true);
    });
  });

  describe('getCategories', () => {
    it('should return all non-deleted categories with counts', async () => {
      mockPrisma.category.findMany.mockResolvedValue([mockCategory]);

      const result = await service.getCategories();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cat-1');
      expect(result[0].name).toBe('Adventure');
      expect(result[0]._count.stories).toBe(15);
      expect(result[0]._count.preferredByKids).toBe(8);
    });

    it('should filter out deleted categories', async () => {
      mockPrisma.category.findMany.mockResolvedValue([]);

      await service.getCategories();

      expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isDeleted: false },
        }),
      );
    });

    it('should order categories by name', async () => {
      mockPrisma.category.findMany.mockResolvedValue([]);

      await service.getCategories();

      expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('should handle categories without optional fields', async () => {
      const categoryWithoutOptionals = {
        ...mockCategory,
        image: null,
        description: null,
        deletedAt: null,
      };
      mockPrisma.category.findMany.mockResolvedValue([categoryWithoutOptionals]);

      const result = await service.getCategories();

      expect(result[0].image).toBeUndefined();
      expect(result[0].description).toBeUndefined();
      expect(result[0].deletedAt).toBeUndefined();
    });
  });

  describe('getThemes', () => {
    it('should return all non-deleted themes with counts', async () => {
      mockPrisma.theme.findMany.mockResolvedValue([mockTheme]);

      const result = await service.getThemes();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('theme-1');
      expect(result[0].name).toBe('Friendship');
      expect(result[0]._count.stories).toBe(20);
    });

    it('should filter out deleted themes', async () => {
      mockPrisma.theme.findMany.mockResolvedValue([]);

      await service.getThemes();

      expect(mockPrisma.theme.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isDeleted: false },
        }),
      );
    });

    it('should order themes by name', async () => {
      mockPrisma.theme.findMany.mockResolvedValue([]);

      await service.getThemes();

      expect(mockPrisma.theme.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('should handle themes without optional fields', async () => {
      const themeWithoutOptionals = {
        ...mockTheme,
        image: null,
        description: null,
        deletedAt: null,
      };
      mockPrisma.theme.findMany.mockResolvedValue([themeWithoutOptionals]);

      const result = await service.getThemes();

      expect(result[0].image).toBeUndefined();
      expect(result[0].description).toBeUndefined();
      expect(result[0].deletedAt).toBeUndefined();
    });
  });
});
