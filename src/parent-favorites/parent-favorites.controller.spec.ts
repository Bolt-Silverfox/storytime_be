import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesController } from './parent-favorites.controller';
import { ParentFavoritesService } from './parent-favorites.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { CreateParentFavoriteDto } from './dto/create-parent-favorite.dto';
import { ParentFavoriteResponseDto } from './dto/parent-favorite-response.dto';

describe('ParentFavoritesController', () => {
  let controller: ParentFavoritesController;
  let service: jest.Mocked<ParentFavoritesService>;

  const mockUserId = 'user-abc-123';
  const mockStoryId = 'd290f1ee-6c54-4b01-90e6-d701748f0851';

  const mockReq = {
    authUserData: { userId: mockUserId },
  } as any;

  const mockFavoriteResponse: ParentFavoriteResponseDto = {
    id: 'fav-001',
    storyId: mockStoryId,
    title: 'The Brave Little Fox',
    description: 'A story about courage',
    coverImageUrl: 'https://example.com/cover.png',
    categories: [{ id: 'cat-1', name: 'Adventure' }],
    ageRange: '3-5',
    durationSeconds: 180,
    createdAt: new Date('2026-01-15T00:00:00Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ParentFavoritesController],
      providers: [
        {
          provide: ParentFavoritesService,
          useValue: {
            addFavorite: jest.fn(),
            getFavorites: jest.fn(),
            removeFavorite: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ParentFavoritesController>(
      ParentFavoritesController,
    );
    service = module.get(ParentFavoritesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('addFavorite', () => {
    it('should call service.addFavorite with userId and dto, and return the result', async () => {
      const dto: CreateParentFavoriteDto = { storyId: mockStoryId };
      service.addFavorite.mockResolvedValue(mockFavoriteResponse);

      const result = await controller.addFavorite(mockReq, dto);

      expect(service.addFavorite).toHaveBeenCalledWith(mockUserId, dto);
      expect(service.addFavorite).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockFavoriteResponse);
    });

    it('should propagate errors thrown by the service', async () => {
      const dto: CreateParentFavoriteDto = { storyId: mockStoryId };
      service.addFavorite.mockRejectedValue(new Error('Story not found'));

      await expect(controller.addFavorite(mockReq, dto)).rejects.toThrow(
        'Story not found',
      );
    });
  });

  describe('getFavorites', () => {
    it('should call service.getFavorites with userId and return the result', async () => {
      const favorites = [mockFavoriteResponse];
      service.getFavorites.mockResolvedValue(favorites);

      const result = await controller.getFavorites(mockReq);

      expect(service.getFavorites).toHaveBeenCalledWith(mockUserId);
      expect(service.getFavorites).toHaveBeenCalledTimes(1);
      expect(result).toEqual(favorites);
    });

    it('should return an empty array when no favorites exist', async () => {
      service.getFavorites.mockResolvedValue([]);

      const result = await controller.getFavorites(mockReq);

      expect(service.getFavorites).toHaveBeenCalledWith(mockUserId);
      expect(result).toEqual([]);
    });

    it('should propagate errors thrown by the service', async () => {
      service.getFavorites.mockRejectedValue(new Error('Database error'));

      await expect(controller.getFavorites(mockReq)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('removeFavorite', () => {
    it('should call service.removeFavorite with userId and storyId, and return the result', async () => {
      const successMessage = 'Favorite removed successfully';
      service.removeFavorite.mockResolvedValue(successMessage as any);

      const result = await controller.removeFavorite(mockReq, mockStoryId);

      expect(service.removeFavorite).toHaveBeenCalledWith(
        mockUserId,
        mockStoryId,
      );
      expect(service.removeFavorite).toHaveBeenCalledTimes(1);
      expect(result).toEqual(successMessage);
    });

    it('should propagate errors thrown by the service', async () => {
      service.removeFavorite.mockRejectedValue(new Error('Favorite not found'));

      await expect(
        controller.removeFavorite(mockReq, mockStoryId),
      ).rejects.toThrow('Favorite not found');
    });
  });
});
