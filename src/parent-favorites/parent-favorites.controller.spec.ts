import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesController } from './parent-favorites.controller';
import { ParentFavoritesService } from './parent-favorites.service';

describe('ParentFavoritesController', () => {
  let controller: ParentFavoritesController;

  const mockParentFavoritesService = {
    addFavorite: jest.fn(),
    getFavorites: jest.fn(),
    removeFavorite: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ParentFavoritesController],
      providers: [
        { provide: ParentFavoritesService, useValue: mockParentFavoritesService },
      ],
    })
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      .overrideGuard(require('../shared/guards/auth.guard').AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ParentFavoritesController>(
      ParentFavoritesController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
