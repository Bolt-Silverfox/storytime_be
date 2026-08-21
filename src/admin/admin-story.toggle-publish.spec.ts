import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminStoryService } from './admin-story.service';
import { ADMIN_STORY_REPOSITORY } from './repositories';

describe('AdminStoryService.toggleStoryPublish', () => {
  let service: AdminStoryService;
  const storyExists = jest.fn().mockResolvedValue(true);
  const findStoryById = jest
    .fn()
    .mockResolvedValue({ id: 's1', isPublished: true });
  const updateStoryPublished = jest
    .fn()
    .mockResolvedValue({ id: 's1', isPublished: false });

  beforeEach(async () => {
    updateStoryPublished.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStoryService,
        {
          provide: ADMIN_STORY_REPOSITORY,
          useValue: { storyExists, findStoryById, updateStoryPublished },
        },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(AdminStoryService);
  });

  it('flips isPublished to the opposite of current', async () => {
    const result = await service.toggleStoryPublish('s1');
    expect(updateStoryPublished).toHaveBeenCalledWith({
      storyId: 's1',
      isPublished: false,
    });
    expect(result.isPublished).toBe(false);
  });
});
