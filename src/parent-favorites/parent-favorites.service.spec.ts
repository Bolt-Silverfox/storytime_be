import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesService } from './parent-favorites.service';
import { PARENT_FAVORITE_REPOSITORY } from './repositories';

describe('ParentFavoritesService', () => {
  let service: ParentFavoritesService;
  const mockRepository = {
    createParentFavorite: jest.fn(),
    findFavoritesByUserId: jest.fn(),
    findFavoritesPaginated: jest.fn(),
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

      mockRepository.createParentFavorite.mockResolvedValue(mockFavorite);

      const result = await service.addFavorite('user-1', mockDto);

      expect(result.ageRange).toBe('3-5');
      expect(result.durationSeconds).toBeUndefined();
      expect(result.categories).toEqual([
        {
          id: 'cat-1',
          name: 'Adventure',
          image: undefined,
          description: undefined,
        },
      ]);
    });
  });

  describe('getFavoritesPaginated', () => {
    it('should return paginated favorites with ageRange and categories mapped', async () => {
      const mockFavorites = [
        {
          id: 'fav-1',
          storyId: 's1',
          story: {
            title: 'Story 1',
            description: 'Desc 1',
            coverImageUrl: 'img1.jpg',
            ageMin: 4,
            ageMax: 6,
            durationSeconds: 120,
            categories: [],
          },
          createdAt: new Date(),
        },
        {
          id: 'fav-2',
          storyId: 's2',
          story: {
            title: 'Story 2',
            description: 'Desc 2',
            coverImageUrl: 'img2.jpg',
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

      mockRepository.findFavoritesPaginated.mockResolvedValue(mockFavorites);

      const result = await service.getFavoritesPaginated('user-1', null, 20);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].ageRange).toBe('4-6');
      expect(result.data[0].durationSeconds).toBe(120);
      expect(result.data[0].categories).toEqual([]);
      expect(result.data[1].ageRange).toBe('7-9');
      expect(result.data[1].durationSeconds).toBeUndefined();
      expect(result.data[1].categories).toEqual([
        {
          id: 'cat-2',
          name: 'Fantasy',
          image: 'img.png',
          description: 'Magical',
        },
      ]);
      expect(result.pagination.hasNextPage).toBe(false);
    });
  });
});
