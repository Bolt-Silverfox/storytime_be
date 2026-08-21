import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminDashboardMetricsService } from './admin-dashboard-metrics.service';
import {
  ADMIN_USER_REPOSITORY,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  ADMIN_PAYMENT_REPOSITORY,
  ADMIN_STORY_REPOSITORY,
  ADMIN_CONTENT_REPOSITORY,
  ADMIN_ENGAGEMENT_REPOSITORY,
} from './repositories';

describe('AdminDashboardMetricsService.getStoryStats', () => {
  let service: AdminDashboardMetricsService;
  const countStories = jest.fn();

  beforeEach(async () => {
    countStories.mockReset();
    // Return a distinct count per where so we can assert mapping regardless of
    // call order.
    countStories.mockImplementation((where: Record<string, unknown>) => {
      if (where.isDeleted === true) return Promise.resolve(7); // deleted
      if (where.isPublished === true) return Promise.resolve(300); // published
      if (where.isPublished === false) return Promise.resolve(12); // draft
      if (where.aiGenerated === true) return Promise.resolve(40);
      if (where.recommended === true) return Promise.resolve(15);
      return Promise.resolve(312); // total (isDeleted:false only)
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardMetricsService,
        { provide: ADMIN_USER_REPOSITORY, useValue: {} },
        { provide: ADMIN_SUBSCRIPTION_REPOSITORY, useValue: {} },
        { provide: ADMIN_PAYMENT_REPOSITORY, useValue: {} },
        { provide: ADMIN_STORY_REPOSITORY, useValue: { countStories } },
        { provide: ADMIN_CONTENT_REPOSITORY, useValue: {} },
        {
          provide: ADMIN_ENGAGEMENT_REPOSITORY,
          useValue: {
            countStoryProgress: jest.fn().mockResolvedValue(0),
            countFavorites: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AdminDashboardMetricsService);
  });

  it('counts published and draft stories by isPublished', async () => {
    const result = await service.getStoryStats();

    expect(countStories).toHaveBeenCalledWith({
      isDeleted: false,
      isPublished: true,
    });
    expect(countStories).toHaveBeenCalledWith({
      isDeleted: false,
      isPublished: false,
    });
    expect(result.publishedStories).toBe(300);
    expect(result.draftStories).toBe(12);
  });
});
