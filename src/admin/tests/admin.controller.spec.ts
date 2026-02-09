import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from '../admin.controller';
import { AdminService } from '../admin.service';
import { AdminAnalyticsService } from '../admin-analytics.service';
import { AdminUserService } from '../admin-user.service';
import { AdminStoryService } from '../admin-story.service';
import { DateRangeDto, UserFilterDto } from '../dto/admin-filters.dto';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

// Mock Admin Service (for non-extracted methods)
const mockAdminService = {
  getRecentActivity: jest.fn(),
  getDeletionRequests: jest.fn(),
  getSubscriptions: jest.fn(),
  seedDatabase: jest.fn(),
  createBackup: jest.fn(),
  getSystemLogs: jest.fn(),
  getElevenLabsBalance: jest.fn(),
  getAllSupportTickets: jest.fn(),
  updateSupportTicket: jest.fn(),
};

// Mock Admin Analytics Service
const mockAdminAnalyticsService = {
  getDashboardStats: jest.fn(),
  getUserGrowth: jest.fn(),
  getSubscriptionAnalytics: jest.fn(),
  getRevenueAnalytics: jest.fn(),
  getStoryStats: jest.fn(),
  getContentBreakdown: jest.fn(),
  getSystemHealth: jest.fn(),
  getAiCreditAnalytics: jest.fn(),
  getUserGrowthMonthly: jest.fn(),
};

// Mock Admin User Service
const mockAdminUserService = {
  getAllUsers: jest.fn(),
  getUserById: jest.fn(),
  createAdmin: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  restoreUser: jest.fn(),
  bulkUserAction: jest.fn(),
};

// Mock Admin Story Service
const mockAdminStoryService = {
  getAllStories: jest.fn(),
  getStoryById: jest.fn(),
  toggleStoryRecommendation: jest.fn(),
  deleteStory: jest.fn(),
  getCategories: jest.fn(),
  getThemes: jest.fn(),
};

describe('AdminController', () => {
  let controller: AdminController;
  let analyticsService: typeof mockAdminAnalyticsService;
  let userService: typeof mockAdminUserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
        {
          provide: AdminAnalyticsService,
          useValue: mockAdminAnalyticsService,
        },
        {
          provide: AdminUserService,
          useValue: mockAdminUserService,
        },
        {
          provide: AdminStoryService,
          useValue: mockAdminStoryService,
        },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
    analyticsService = module.get(AdminAnalyticsService);
    userService = module.get(AdminUserService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Dashboard Endpoints', () => {
    it('getDashboardStats: should return stats', async () => {
      const mockStats = { totalUsers: 100, totalRevenue: 5000 };
      analyticsService.getDashboardStats.mockResolvedValue(mockStats);

      const result = (await controller.getDashboardStats()) as any;

      expect(result.data).toEqual(mockStats);
      expect(analyticsService.getDashboardStats).toHaveBeenCalled();
    });

    it('getUserGrowth: should return growth data', async () => {
      const mockDateRange: DateRangeDto = { startDate: '2023-01-01' };
      const mockGrowth = [{ date: '2023-01-01', newUsers: 5 }];
      analyticsService.getUserGrowth.mockResolvedValue(mockGrowth);

      const result = (await controller.getUserGrowth(mockDateRange)) as any;

      expect(result.data).toEqual(mockGrowth);
      expect(analyticsService.getUserGrowth).toHaveBeenCalledWith(mockDateRange);
    });
  });

  describe('User Management Endpoints', () => {
    it('getAllUsers: should return paginated users', async () => {
      const mockFilters: UserFilterDto = { page: 1, limit: 10 };
      const mockResult = { data: [{ id: '1' }], meta: { total: 1 } };
      userService.getAllUsers.mockResolvedValue(mockResult);

      const result = (await controller.getAllUsers(mockFilters)) as any;

      expect(result.data).toEqual(mockResult.data);
      expect(result.meta).toEqual(mockResult.meta);
      expect(userService.getAllUsers).toHaveBeenCalledWith(mockFilters);
    });

    it('getUserById: should return user details', async () => {
      const userId = 'user-1';
      const mockUser = { id: userId, name: 'Test' };
      userService.getUserById.mockResolvedValue(mockUser);

      const result = (await controller.getUserById(userId)) as any;

      expect(result.data).toEqual(mockUser);
      expect(userService.getUserById).toHaveBeenCalledWith(userId);
    });
  });
});
