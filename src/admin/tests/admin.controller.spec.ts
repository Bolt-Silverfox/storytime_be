import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from '../admin.controller';
import { AdminService } from '../admin.service';
import { DateRangeDto, UserFilterDto } from '../dto/admin-filters.dto';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

// Mock Admin Service
const mockAdminService = {
    getDashboardStats: jest.fn(),
    getUserGrowth: jest.fn(),
    getAllUsers: jest.fn(),
    getUserById: jest.fn(),
};

describe('AdminController', () => {
    let controller: AdminController;
    let service: typeof mockAdminService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AdminController],
            providers: [
                {
                    provide: AdminService,
                    useValue: mockAdminService,
                },
            ],
        })
            .overrideGuard(AuthSessionGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(AdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<AdminController>(AdminController);
        service = module.get(AdminService); // get the mock value injected
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('Dashboard Endpoints', () => {
        it('getDashboardStats: should return stats', async () => {
            const mockStats = { totalUsers: 100, totalRevenue: 5000 };
            service.getDashboardStats.mockResolvedValue(mockStats);

            const result = await controller.getDashboardStats() as any;

            expect(result.data).toEqual(mockStats);
            expect(service.getDashboardStats).toHaveBeenCalled();
        });

        it('getUserGrowth: should return growth data', async () => {
            const mockDateRange: DateRangeDto = { startDate: '2023-01-01' };
            const mockGrowth = [{ date: '2023-01-01', newUsers: 5 }];
            service.getUserGrowth.mockResolvedValue(mockGrowth);

            const result = await controller.getUserGrowth(mockDateRange) as any;

            expect(result.data).toEqual(mockGrowth);
            expect(service.getUserGrowth).toHaveBeenCalledWith(mockDateRange);
        });
    });

    describe('User Management Endpoints', () => {
        it('getAllUsers: should return paginated users', async () => {
            const mockFilters: UserFilterDto = { page: 1, limit: 10 };
            const mockResult = { data: [{ id: '1' }], meta: { total: 1 } };
            service.getAllUsers.mockResolvedValue(mockResult);

            const result = await controller.getAllUsers(mockFilters) as any;

            expect(result.data).toEqual(mockResult.data);
            expect(result.meta).toEqual(mockResult.meta);
            expect(service.getAllUsers).toHaveBeenCalledWith(mockFilters);
        });

        it('getUserById: should return user details', async () => {
            const userId = 'user-1';
            const mockUser = { id: userId, name: 'Test' };
            service.getUserById.mockResolvedValue(mockUser);

            const result = await controller.getUserById(userId) as any;

            expect(result.data).toEqual(mockUser);
            expect(service.getUserById).toHaveBeenCalledWith(userId);
        });
    });
});
