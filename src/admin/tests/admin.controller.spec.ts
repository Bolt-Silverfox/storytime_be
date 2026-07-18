import { Test, TestingModule } from '@nestjs/testing';
import { AdminDashboardController } from '../admin-dashboard.controller';
import { AdminUserQueryController } from '../admin-user-query.controller';
import { AdminStoryAdminController } from '../admin-story-admin.controller';
import { AdminSystemController } from '../admin-system.controller';
import { AdminService } from '../admin.service';
import { AdminStoryService } from '../admin-story.service';
import { AdminSystemService } from '../admin-system.service';
import { DateRangeDto, UserFilterDto } from '../dto/admin-filters.dto';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

// The controller delegates dashboard/user/analytics logic to the monolithic
// AdminService, and story-read/system logic to the extracted services. Mock the
// methods exercised by these tests.
const mockAdminService = {
  getDashboardStats: jest.fn(),
  getUserGrowth: jest.fn(),
  getUserGrowthMonthly: jest.fn(),
  getAllUsers: jest.fn(),
  getUserById: jest.fn(),
};

// Extracted story service — controller re-points the read endpoints to it.
const mockAdminStoryService = {
  getAllStories: jest.fn(),
  getCategories: jest.fn(),
  getThemes: jest.fn(),
};

// Extracted system service — controller re-points system endpoints to it.
const mockAdminSystemService = {
  getRecentActivity: jest.fn(),
  getSubscriptions: jest.fn(),
  getAllSupportTickets: jest.fn(),
  updateSupportTicket: jest.fn(),
  createSupportTicket: jest.fn(),
  getDeletionRequests: jest.fn(),
  getElevenLabsBalance: jest.fn(),
  createBackup: jest.fn(),
};

describe('AdminController', () => {
  let dashboardController: AdminDashboardController;
  let userController: AdminUserQueryController;
  let storyController: AdminStoryAdminController;
  let systemController: AdminSystemController;
  let adminService: typeof mockAdminService;
  let adminStoryService: typeof mockAdminStoryService;
  let adminSystemService: typeof mockAdminSystemService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [
        AdminDashboardController,
        AdminUserQueryController,
        AdminStoryAdminController,
        AdminSystemController,
      ],
      providers: [
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
        {
          provide: AdminStoryService,
          useValue: mockAdminStoryService,
        },
        {
          provide: AdminSystemService,
          useValue: mockAdminSystemService,
        },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    dashboardController = module.get<AdminDashboardController>(
      AdminDashboardController,
    );
    userController = module.get<AdminUserQueryController>(
      AdminUserQueryController,
    );
    storyController = module.get<AdminStoryAdminController>(
      AdminStoryAdminController,
    );
    systemController = module.get<AdminSystemController>(AdminSystemController);
    adminService = module.get(AdminService);
    adminStoryService = module.get(AdminStoryService);
    adminSystemService = module.get(AdminSystemService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(dashboardController).toBeDefined();
    expect(userController).toBeDefined();
    expect(storyController).toBeDefined();
    expect(systemController).toBeDefined();
  });

  describe('Dashboard Endpoints', () => {
    it('getDashboardStats: should return stats', async () => {
      const mockStats = { totalUsers: 100, totalRevenue: 5000 };
      adminService.getDashboardStats.mockResolvedValue(mockStats);

      const result = (await dashboardController.getDashboardStats()) as any;

      expect(result.data).toEqual(mockStats);
      expect(adminService.getDashboardStats).toHaveBeenCalled();
    });

    it('getUserGrowth: should return growth data', async () => {
      const mockDateRange: DateRangeDto = { startDate: '2023-01-01' };
      const mockGrowth = [{ date: '2023-01-01', newUsers: 5 }];
      adminService.getUserGrowth.mockResolvedValue(mockGrowth);

      const result = (await dashboardController.getUserGrowth(
        mockDateRange,
      )) as any;

      expect(result.data).toEqual(mockGrowth);
      expect(adminService.getUserGrowth).toHaveBeenCalledWith(mockDateRange);
    });
  });

  describe('User Management Endpoints', () => {
    it('getAllUsers: should return paginated users', async () => {
      const mockFilters: UserFilterDto = { page: 1, limit: 10 };
      const mockResult = { data: [{ id: '1' }], meta: { total: 1 } };
      adminService.getAllUsers.mockResolvedValue(mockResult);

      const result = (await userController.getAllUsers(mockFilters)) as any;

      expect(result.data).toEqual(mockResult.data);
      expect(result.meta).toEqual(mockResult.meta);
      expect(adminService.getAllUsers).toHaveBeenCalledWith(mockFilters);
    });

    it('getUserById: should return user details', async () => {
      const userId = 'user-1';
      const mockUser = { id: userId, name: 'Test' };
      adminService.getUserById.mockResolvedValue(mockUser);

      const result = (await userController.getUserById(userId)) as any;

      expect(result.data).toEqual(mockUser);
      expect(adminService.getUserById).toHaveBeenCalledWith(userId);
    });
  });

  describe('Story Endpoints (delegated to AdminStoryService)', () => {
    it('getAllStories: should delegate to the story service', async () => {
      const mockResult = { data: [{ id: 'story-1' }], meta: { total: 1 } };
      adminStoryService.getAllStories.mockResolvedValue(mockResult);

      const result = (await storyController.getAllStories({} as any)) as any;

      expect(result.data).toEqual(mockResult.data);
      expect(result.meta).toEqual(mockResult.meta);
      expect(adminStoryService.getAllStories).toHaveBeenCalled();
    });

    it('getCategories: should delegate to the story service', async () => {
      const mockCategories = [{ id: 'cat-1', name: 'Adventure' }];
      adminStoryService.getCategories.mockResolvedValue(mockCategories);

      const result = (await storyController.getCategories()) as any;

      expect(result.data).toEqual(mockCategories);
      expect(adminStoryService.getCategories).toHaveBeenCalled();
    });

    it('getThemes: should delegate to the story service', async () => {
      const mockThemes = [{ id: 'theme-1', name: 'Friendship' }];
      adminStoryService.getThemes.mockResolvedValue(mockThemes);

      const result = (await storyController.getThemes()) as any;

      expect(result.data).toEqual(mockThemes);
      expect(adminStoryService.getThemes).toHaveBeenCalled();
    });
  });

  describe('System Endpoints (delegated to AdminSystemService)', () => {
    it('getSubscriptions: should delegate to the system service', async () => {
      const mockSubs = [{ id: 'sub-1', plan: 'monthly' }];
      adminSystemService.getSubscriptions.mockResolvedValue(mockSubs);

      const result = (await systemController.getSubscriptions('active')) as any;

      expect(result.data).toEqual(mockSubs);
      expect(adminSystemService.getSubscriptions).toHaveBeenCalledWith('active');
    });

    it('createBackup: should delegate to the system service', () => {
      const mockBackup = { message: 'Backup created successfully', timestamp: new Date() };
      adminSystemService.createBackup.mockReturnValue(mockBackup);

      const result = systemController.createBackup() as any;

      expect(result.data).toEqual(mockBackup);
      expect(adminSystemService.createBackup).toHaveBeenCalled();
    });

    it('getElevenLabsBalance: should delegate to the system service', async () => {
      const mockBalance = { tier: 'pro', characterCount: 5 };
      adminSystemService.getElevenLabsBalance.mockResolvedValue(mockBalance);

      const result = (await systemController.getElevenLabsBalance()) as any;

      expect(result.data).toEqual(mockBalance);
      expect(adminSystemService.getElevenLabsBalance).toHaveBeenCalled();
    });

    it('getDeletionRequests: should delegate to the system service', async () => {
      const mockResult = { data: [{ id: 'ticket-1' }], meta: { total: 1 } };
      adminSystemService.getDeletionRequests.mockResolvedValue(mockResult);

      const result = (await userController.getDeletionRequests(1, 10)) as any;

      expect(result.data).toEqual(mockResult.data);
      expect(result.meta).toEqual(mockResult.meta);
      expect(adminSystemService.getDeletionRequests).toHaveBeenCalled();
    });
  });
});
