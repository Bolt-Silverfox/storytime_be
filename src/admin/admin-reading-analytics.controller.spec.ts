import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminReadingAnalyticsController } from './admin-reading-analytics.controller';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminReadingAnalyticsController', () => {
  let controller: AdminReadingAnalyticsController;
  const getTopStoriesPage = jest.fn();
  const getStoryDetail = jest.fn();
  const getStoryTrend = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminReadingAnalyticsController],
      providers: [
        {
          provide: AdminReadingAnalyticsService,
          useValue: { getTopStoriesPage, getStoryDetail, getStoryTrend },
        },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AdminReadingAnalyticsController);
  });

  it('wires AuthSessionGuard and AdminGuard on the controller (@Admin())', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminReadingAnalyticsController),
    ).toEqual([AuthSessionGuard, AdminGuard]);
  });

  it('getTopStories delegates the query and returns data plus meta', async () => {
    const meta = { total: 0, page: 2, limit: 10, totalPages: 0 };
    getTopStoriesPage.mockResolvedValue({ data: [], meta });
    const result = await controller.getTopStories({
      range: 7,
      page: 2,
      limit: 10,
    });
    expect(getTopStoriesPage).toHaveBeenCalledWith({
      range: 7,
      page: 2,
      limit: 10,
    });
    expect(result.meta).toEqual(meta);
  });

  it('getStoryDetail delegates with the story id and range', async () => {
    getStoryDetail.mockResolvedValue({ storyId: 's1' });
    const result = await controller.getStoryDetail('s1', { range: 30 });
    expect(getStoryDetail).toHaveBeenCalledWith('s1', { range: 30 });
    expect(result.data?.storyId).toBe('s1');
  });

  it('getStoryTrend delegates with the story id and range', async () => {
    getStoryTrend.mockResolvedValue([]);
    await controller.getStoryTrend('s1', { range: 90 });
    expect(getStoryTrend).toHaveBeenCalledWith('s1', { range: 90 });
  });
});
