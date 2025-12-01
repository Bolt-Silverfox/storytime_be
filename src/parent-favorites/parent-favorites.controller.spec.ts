import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesController } from './parent-favorites.controller';

describe('ParentFavoritesController', () => {
  let controller: ParentFavoritesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ParentFavoritesController],
    }).compile();

    controller = module.get<ParentFavoritesController>(ParentFavoritesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
