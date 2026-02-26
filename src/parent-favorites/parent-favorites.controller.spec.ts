import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesController } from './parent-favorites.controller';
import { ParentFavoritesService } from './parent-favorites.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';

describe('ParentFavoritesController', () => {
  let controller: ParentFavoritesController;

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
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
