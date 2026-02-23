import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesService } from './parent-favorites.service';
import { PARENT_FAVORITE_REPOSITORY } from './repositories';

describe('ParentFavoritesService', () => {
  let service: ParentFavoritesService;
  const mockRepository = {
    createParentFavorite: jest.fn(),
    findFavoritesByUserId: jest.fn(),
    findFavorite: jest.fn(),
    deleteParentFavorite: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentFavoritesService,
        { provide: PARENT_FAVORITE_REPOSITORY, useValue: mockRepository },
      ],
    }).compile();

    service = module.get<ParentFavoritesService>(ParentFavoritesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addFavorite', () => {
    it('should add a favorite and return the response with ageRange and categories', async () => {
      const mockDto = { storyId: 'story-123' };
      const mockFavorite = {
        id: 'fav-1',
        storyId: 'story-123',
        userId: 'user-1',
        story: {
          title: 'Test Story',
          description: 'A test story',
          coverImageUrl: 'http://test.com/image.jpg',
          ageMin: 3,
          ageMax: 5,
          durationSeconds: 120,
          categories: [
            { id: 'cat-1', name: 'Adventure', image: null, description: null },
          ],
        },
        createdAt: new Date(),
      };

      mockRepository.createParentFavorite.mockResolvedValue(mockFavorite);

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
        durationSeconds: 120,
        createdAt: mockFavorite.createdAt,
      });
    });
  });

  describe('getFavorites', () => {
    it('should return a list of favorites with ageRange and categories', async () => {
      const mockFavorites = [
        {
          id: 'fav-1',
          storyId: 'story-1',
          userId: 'user-1',
          story: {
            title: 'Story 1',
            description: 'Desc 1',
            coverImageUrl: 'url1',
            ageMin: 4,
            ageMax: 6,
            durationSeconds: null,
            categories: [],
          },
          createdAt: new Date(),
        },
        {
          id: 'fav-2',
          storyId: 'story-2',
          userId: 'user-1',
          story: {
            title: 'Story 2',
            description: 'Desc 2',
            coverImageUrl: 'url2',
            ageMin: 7,
            ageMax: 9,
            durationSeconds: 300,
            categories: [
              {
                id: 'cat-1',
                name: 'Fantasy',
                image: 'img.png',
                description: 'A fantasy category',
              },
            ],
          },
          createdAt: new Date(),
        },
      ];

      mockRepository.findFavoritesByUserId.mockResolvedValue(mockFavorites);

      const result = await service.getFavorites('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].ageRange).toBe('4-6');
      expect(result[1].ageRange).toBe('7-9');
      expect(result[1].categories).toEqual([
        {
          id: 'cat-1',
          name: 'Fantasy',
          image: 'img.png',
          description: 'A fantasy category',
        },
      ]);
    });
  });
});
