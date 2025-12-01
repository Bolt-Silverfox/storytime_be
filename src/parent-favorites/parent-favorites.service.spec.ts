import { Test, TestingModule } from '@nestjs/testing';
import { ParentFavoritesService } from './parent-favorites.service';

describe('ParentFavoritesService', () => {
  let service: ParentFavoritesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ParentFavoritesService],
    }).compile();

    service = module.get<ParentFavoritesService>(ParentFavoritesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
