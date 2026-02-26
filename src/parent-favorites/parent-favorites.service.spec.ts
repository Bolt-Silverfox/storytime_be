import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesService } from './parent-favorites.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ParentFavoritesService', () => {
  let service: ParentFavoritesService;
  const mockPrismaService = {
    parentFavorite: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentFavoritesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ParentFavoritesService>(ParentFavoritesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addFavorite', () => {
    it('should add a favorite and return the response with ageRange', async () => {
      const mockDto = { storyId: 'story-123' };
      const mockFavorite = {
        id: 'fav-1',
        storyId: 'story-123',
        story: {
          title: 'Test Story',
          description: 'A test story',
          coverImageUrl: 'http://test.com/image.jpg',
          ageMin: 3,
          ageMax: 5,
          durationSeconds: null,
          categories: [
            { id: 'cat-1', name: 'Adventure', image: null, description: null },
          ],
        },
        createdAt: new Date(),
      };

      mockPrismaService.parentFavorite.create.mockResolvedValue(mockFavorite);

      const result = await service.addFavorite('user-1', mockDto);

      expect(result).toEqual({
        id: mockFavorite.id,
        storyId: mockFavorite.storyId,
        title: mockFavorite.story.title,
        description: mockFavorite.story.description,
        coverImageUrl: mockFavorite.story.coverImageUrl,
        categories: [
          {
            id: 'cat-1',
            name: 'Adventure',
            image: undefined,
            description: undefined,
          },
        ],
        ageRange: '3-5',
        durationSeconds: undefined,
        createdAt: mockFavorite.createdAt,
      });
    });
  });

  describe('getFavorites', () => {
    it('should return a list of favorites with ageRange', async () => {
      const mockFavorites = [
        {
          id: 'fav-1',
          storyId: 'story-1',
          story: {
            title: 'Story 1',
            description: 'Desc 1',
            coverImageUrl: 'url1',
            ageMin: 4,
            ageMax: 6,
            durationSeconds: 120,
            categories: [],
          },
          createdAt: new Date(),
        },
        {
          id: 'fav-2',
          storyId: 'story-2',
          story: {
            title: 'Story 2',
            description: 'Desc 2',
            coverImageUrl: 'url2',
            ageMin: 7,
            ageMax: 9,
            durationSeconds: null,
            categories: [
              {
                id: 'cat-2',
                name: 'Fantasy',
                image: 'img.png',
                description: 'Magical',
              },
            ],
          },
          createdAt: new Date(),
        },
      ];

      mockPrismaService.parentFavorite.findMany.mockResolvedValue(
        mockFavorites,
      );

      const result = await service.getFavorites('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].ageRange).toBe('4-6');
      expect(result[1].ageRange).toBe('7-9');
      expect(result[1].categories).toEqual([
        {
          id: 'cat-2',
          name: 'Fantasy',
          image: 'img.png',
          description: 'Magical',
        },
      ]);
    });
  });
});
