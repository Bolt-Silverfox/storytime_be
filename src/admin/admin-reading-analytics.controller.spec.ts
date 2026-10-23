import { Test, TestingModule } from '@nestjs/testing';
import { AdminReadingAnalyticsController } from './admin-reading-analytics.controller';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminReadingAnalyticsController', () => {
  let controller: AdminReadingAnalyticsController;
  const getTopStories = jest.fn();
  const getStoryDetail = jest.fn();
  const getStoryTrend = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminReadingAnalyticsController],
      providers: [
        {
          provide: AdminReadingAnalyticsService,
          useValue: { getTopStories, getStoryDetail, getStoryTrend },
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

  it('getTopStories delegates to the service with the parsed range', async () => {
    getTopStories.mockResolvedValue([]);
    await controller.getTopStories({ range: 7 });
    expect(getTopStories).toHaveBeenCalledWith({ range: 7 });
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
