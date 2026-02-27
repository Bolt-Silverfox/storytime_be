import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminService } from '../admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ElevenLabsTTSProvider } from '../../voice/providers/eleven-labs-tts.provider';

// Mock Cache Manager
const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  reset: jest.fn(),
};

// Mock ElevenLabs TTS Provider
const mockElevenLabsProvider = {
  getUsageStats: jest.fn(),
};

// Mock Prisma Service
const mockPrismaService = {
  user: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
  },
  kid: {
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  story: {
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  category: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  theme: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  storyProgress: {
    count: jest.fn(),
  },
  favorite: {
    count: jest.fn(),
  },
  subscription: {
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  paymentTransaction: {
    aggregate: jest.fn(),
  },
  screenTimeSession: {
    findMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

describe('AdminService', () => {
  let service: AdminService;
  let prisma: typeof mockPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ElevenLabsTTSProvider,
          useValue: mockElevenLabsProvider,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardStats', () => {
    it('should return aggregated dashboard statistics', async () => {
      // Mock data
      const mockUsers = [
        {
          id: '1',
          subscription: {
            status: 'active',
            endsAt: new Date(Date.now() + 10000),
          },
        }, // Paid
        { id: '2', subscription: null }, // Unpaid
      ];

      prisma.user.findMany.mockResolvedValue(mockUsers);
      prisma.user.count.mockResolvedValue(100); // Generic count return
      prisma.kid.count.mockResolvedValue(5);
      prisma.story.count.mockResolvedValue(20);
      prisma.category.count.mockResolvedValue(3);
      prisma.theme.count.mockResolvedValue(4);
      prisma.storyProgress.count.mockResolvedValue(100);
      prisma.favorite.count.mockResolvedValue(50);
      prisma.subscription.count.mockResolvedValue(15);
      prisma.paymentTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 5000 },
      });
      prisma.screenTimeSession.findMany.mockResolvedValue([
        { duration: 10 },
        { duration: 20 },
      ]);
      prisma.subscription.groupBy.mockResolvedValue([
        { plan: 'monthly', _count: 10 },
        { plan: 'yearly', _count: 5 },
      ]);

      const result = await service.getDashboardStats();

      // Verify structure and key values
      // The service uses prisma.user.count() for totalUsers (returns 100),
      // subscription.count() for paidUsers (returns 15), and
      // averageSessionTime is a placeholder (0).
      expect(result).toBeDefined();
      expect(result.totalUsers).toBe(100);
      expect(result.paidUsers).toBe(15); // activeSubscriptionsCount from subscription.count
      expect(result.unpaidUsers).toBe(85); // totalUsers - paidUsers = 100 - 15
      expect(result.totalKids).toBe(5);
      expect(result.totalRevenue).toBe(5000);
      expect(result.averageSessionTime).toBe(0); // Placeholder in service
      expect(result.subscriptionPlans).toHaveLength(2);
    });
  });

  describe('getUserGrowth', () => {
    it('should return user growth stats grouped by date', async () => {
      const mockDateRange = { startDate: '2023-01-01', endDate: '2023-01-02' };
      const mockUsers = [
        { createdAt: new Date('2023-01-01T10:00:00Z'), subscription: null },
        {
          createdAt: new Date('2023-01-01T12:00:00Z'),
          subscription: { status: 'active' },
        },
        { createdAt: new Date('2023-01-02T10:00:00Z'), subscription: null },
      ];

      prisma.user.findMany.mockResolvedValue(mockUsers);
      prisma.user.count
        .mockResolvedValueOnce(100) // totalUsers before
        .mockResolvedValueOnce(50); // totalPaidUsers before

      const result = await service.getUserGrowth(mockDateRange);

      expect(result).toHaveLength(2);

      // 2023-01-01: 2 users, 1 paid
      const day1 = result.find((r) => r.date === '2023-01-01');
      expect(day1).toBeDefined();
      expect(day1!.newUsers).toBe(2);
      expect(day1!.paidUsers).toBe(1);
      expect(day1!.totalUsers).toBe(102); // 100 + 2

      // 2023-01-02: 1 user, 0 paid
      const day2 = result.find((r) => r.date === '2023-01-02');
      expect(day2).toBeDefined();
      expect(day2!.newUsers).toBe(1);
      expect(day2!.totalUsers).toBe(103); // 102 + 1
    });
  });

  describe('User Management', () => {
    it('getAllUsers: should return paginated users with mapped fields', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          email: 'test@example.com',
          createdAt: new Date(),
          subscription: {
            id: 'sub-1',
            status: 'active',
            endsAt: new Date(Date.now() + 10000),
          },
          usage: { elevenLabsCount: 3 },
          kids: [
            {
              screenTimeSessions: [{ duration: 10 }, { duration: 20 }],
            },
          ],
          paymentTransactions: [{ amount: 50 }, { amount: 25 }],
          _count: {
            kids: 2,
            auth: 5,
            parentFavorites: 3,
            paymentTransactions: 4,
          },
        },
      ];

      prisma.user.findMany.mockResolvedValue(mockUsers);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.getAllUsers({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.data[0].isPaidUser).toBe(true);
      expect(result.data[0].kidsCount).toBe(2);
      expect(result.data[0].sessionsCount).toBe(5);
    });

    it('getUserById: should return detailed user info', async () => {
      const userId = 'user-1';
      const mockUser = {
        id: userId,
        email: 'test@example.com',
        subscription: {
          status: 'active',
          endsAt: new Date(Date.now() + 10000),
        },
        _count: {
          auth: 10,
          parentFavorites: 5,
          voices: 1,
          supportTickets: 0,
          paymentTransactions: 5,
        },
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.paymentTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 100 },
      });

      const result = await service.getUserById(userId);

      expect(result.id).toBe(userId);
      expect(result.isPaidUser).toBe(true);
      expect(result.totalSpent).toBe(100);
      expect(result.stats.sessionsCount).toBe(10);
    });

    it('getUserById: should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getUserById('bad-id')).rejects.toThrow(
        'User with ID bad-id not found',
      );
    });

    it('updateUser: should update user fields', async () => {
      const userId = 'user-1';
      const updateDto = { name: 'New Name' };
      prisma.user.findUnique.mockResolvedValue({
        id: userId,
        email: 'old@example.com',
      });
      prisma.user.update.mockResolvedValue({ id: userId, name: 'New Name' });

      const result = await service.updateUser(userId, updateDto);
      expect(result.name).toBe('New Name');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: userId },
          data: expect.objectContaining({ name: 'New Name' }),
        }),
      );
    });
  });
});
