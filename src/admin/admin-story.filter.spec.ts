import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminStoryService } from './admin-story.service';
import { ADMIN_STORY_REPOSITORY } from './repositories';

describe('AdminStoryService.getAllStories isPublished filter', () => {
  let service: AdminStoryService;
  const findStories = jest.fn().mockResolvedValue([]);
  const countStories = jest.fn().mockResolvedValue(0);

  beforeEach(async () => {
    findStories.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStoryService,
        { provide: ADMIN_STORY_REPOSITORY, useValue: { findStories, countStories } },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();
    service = module.get(AdminStoryService);
  });

  it('passes isPublished:false through to the where clause', async () => {
    await service.getAllStories({ isPublished: false } as never);
    expect(findStories).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isPublished: false }) }),
    );
  });

  it('omits isPublished from where when not provided', async () => {
    await service.getAllStories({} as never);
    const arg = findStories.mock.calls[0][0];
    expect(arg.where).not.toHaveProperty('isPublished');
  });
});
