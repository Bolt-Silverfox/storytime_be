import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdminSystemService } from './admin-system.service';
import {
  ADMIN_SYSTEM_REPOSITORY,
  IAdminSystemRepository,
} from './repositories/admin-system.repository.interface';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationException } from '@/shared/exceptions';

describe('AdminSystemService', () => {
  let service: AdminSystemService;
  let systemRepository: jest.Mocked<IAdminSystemRepository>;
  let elevenLabsProvider: jest.Mocked<ElevenLabsTTSProvider>;
  let prismaService: any;
  let mockCacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  const mockActivityLog = {
    id: 'activity-1',
    userId: 'user-123',
    action: 'LOGIN',
    status: 'info',
    message: 'User logged in',
    createdAt: new Date('2025-01-15'),
    isDeleted: false,
  };

  const mockSubscription = {
    id: 'sub-1',
    userId: 'user-123',
    plan: 'premium',
    status: 'active',
    startedAt: new Date('2025-01-01'),
    isDeleted: false,
  };

  const mockSupportTicket = {
    id: 'ticket-1',
    userId: 'user-123',
    subject: 'Bug report',
    message: 'Something is broken',
    status: 'open',
    createdAt: new Date('2025-02-01'),
    user: {
      email: 'user@example.com',
      name: 'Test User',
    },
  };

  const mockDeletionTicket = {
    id: 'ticket-2',
    userId: 'user-456',
    subject: 'Delete Account Request',
    message: 'Reasons: Too expensive, Not useful\nNotes: Please hurry\nPermanent deletion requested',
    status: 'open',
    createdAt: new Date('2025-02-10'),
    user: {
      email: 'delete@example.com',
      name: 'Delete User',
    },
  };

  beforeEach(async () => {
    const mockAdminSystemRepository: Record<
      keyof IAdminSystemRepository,
      jest.Mock
    > = {
      findActivityLogs: jest.fn(),
      countActivityLogs: jest.fn(),
      findSubscriptions: jest.fn(),
      findSupportTickets: jest.fn(),
      countSupportTickets: jest.fn(),
      findSupportTicketById: jest.fn(),
      updateSupportTicket: jest.fn(),
    };

    const mockElevenLabsProvider = {
      getSubscriptionInfo: jest.fn(),
    };

    const mockPrismaService = {
      category: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      theme: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      ageGroup: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      avatar: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSystemService,
        {
          provide: ADMIN_SYSTEM_REPOSITORY,
          useValue: mockAdminSystemRepository,
        },
        {
          provide: ElevenLabsTTSProvider,
          useValue: mockElevenLabsProvider,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<AdminSystemService>(AdminSystemService);
    systemRepository = module.get(ADMIN_SYSTEM_REPOSITORY);
    elevenLabsProvider = module.get(ElevenLabsTTSProvider);
    prismaService = module.get(PrismaService);
    jest.clearAllMocks();
  });

  // =====================
  // getRecentActivity
  // =====================

  describe('getRecentActivity', () => {
    it('should return recent activity logs with default limit', async () => {
      systemRepository.findActivityLogs.mockResolvedValue([
        mockActivityLog as any,
      ]);

      const result = await service.getRecentActivity();

      expect(result).toEqual([mockActivityLog]);
      expect(systemRepository.findActivityLogs).toHaveBeenCalledWith({
        where: { isDeleted: false },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should apply custom limit', async () => {
      systemRepository.findActivityLogs.mockResolvedValue([]);

      await service.getRecentActivity(10);

      expect(systemRepository.findActivityLogs).toHaveBeenCalledWith({
        where: { isDeleted: false },
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by userId when provided', async () => {
      systemRepository.findActivityLogs.mockResolvedValue([
        mockActivityLog as any,
      ]);

      await service.getRecentActivity(50, 'user-123');

      expect(systemRepository.findActivityLogs).toHaveBeenCalledWith({
        where: { isDeleted: false, userId: 'user-123' },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no activity exists', async () => {
      systemRepository.findActivityLogs.mockResolvedValue([]);

      const result = await service.getRecentActivity();

      expect(result).toEqual([]);
    });
  });

  // =====================
  // getSystemLogs
  // =====================

  describe('getSystemLogs', () => {
    it('should return system logs with default limit', async () => {
      systemRepository.findActivityLogs.mockResolvedValue([
        mockActivityLog as any,
      ]);

      const result = await service.getSystemLogs();

      expect(result).toEqual([mockActivityLog]);
      expect(systemRepository.findActivityLogs).toHaveBeenCalledWith({
        where: { isDeleted: false },
        take: 100,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by level when provided', async () => {
      systemRepository.findActivityLogs.mockResolvedValue([]);

      await service.getSystemLogs('error', 50);

      expect(systemRepository.findActivityLogs).toHaveBeenCalledWith({
        where: { isDeleted: false, status: 'error' },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should use custom limit', async () => {
      systemRepository.findActivityLogs.mockResolvedValue([]);

      await service.getSystemLogs(undefined, 25);

      expect(systemRepository.findActivityLogs).toHaveBeenCalledWith({
        where: { isDeleted: false },
        take: 25,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  // =====================
  // getSubscriptions
  // =====================

  describe('getSubscriptions', () => {
    it('should return all non-deleted subscriptions', async () => {
      systemRepository.findSubscriptions.mockResolvedValue([
        mockSubscription as any,
      ]);

      const result = await service.getSubscriptions();

      expect(result).toEqual([mockSubscription]);
      expect(systemRepository.findSubscriptions).toHaveBeenCalledWith({
        where: { isDeleted: false },
        orderBy: { startedAt: 'desc' },
      });
    });

    it('should filter by status when provided', async () => {
      systemRepository.findSubscriptions.mockResolvedValue([]);

      await service.getSubscriptions('active');

      expect(systemRepository.findSubscriptions).toHaveBeenCalledWith({
        where: { isDeleted: false, status: 'active' },
        orderBy: { startedAt: 'desc' },
      });
    });

    it('should return empty array when no subscriptions exist', async () => {
      systemRepository.findSubscriptions.mockResolvedValue([]);

      const result = await service.getSubscriptions();

      expect(result).toEqual([]);
    });
  });

  // =====================
  // getAllSupportTickets
  // =====================

  describe('getAllSupportTickets', () => {
    it('should return paginated support tickets', async () => {
      systemRepository.findSupportTickets.mockResolvedValue([
        mockSupportTicket as any,
      ]);
      systemRepository.countSupportTickets.mockResolvedValue(1);

      const result = await service.getAllSupportTickets();

      expect(result.data).toEqual([mockSupportTicket]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('should apply correct skip for page 2', async () => {
      systemRepository.findSupportTickets.mockResolvedValue([]);
      systemRepository.countSupportTickets.mockResolvedValue(15);

      const result = await service.getAllSupportTickets(2, 10);

      expect(systemRepository.findSupportTickets).toHaveBeenCalledWith({
        where: {},
        skip: 10,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter by status when provided', async () => {
      systemRepository.findSupportTickets.mockResolvedValue([]);
      systemRepository.countSupportTickets.mockResolvedValue(0);

      await service.getAllSupportTickets(1, 10, 'open');

      expect(systemRepository.findSupportTickets).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'open' },
        }),
      );
    });

    it('should handle empty results', async () => {
      systemRepository.findSupportTickets.mockResolvedValue([]);
      systemRepository.countSupportTickets.mockResolvedValue(0);

      const result = await service.getAllSupportTickets();

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  // =====================
  // updateSupportTicket
  // =====================

  describe('updateSupportTicket', () => {
    it('should update support ticket status', async () => {
      const updatedTicket = { ...mockSupportTicket, status: 'resolved' };
      systemRepository.updateSupportTicket.mockResolvedValue(
        updatedTicket as any,
      );

      const result = await service.updateSupportTicket('ticket-1', 'resolved');

      expect(result).toEqual(updatedTicket);
      expect(systemRepository.updateSupportTicket).toHaveBeenCalledWith(
        'ticket-1',
        'resolved',
      );
    });
  });

  // =====================
  // getDeletionRequests
  // =====================

  describe('getDeletionRequests', () => {
    it('should return parsed deletion requests', async () => {
      systemRepository.findSupportTickets.mockResolvedValue([
        mockDeletionTicket as any,
      ]);
      systemRepository.countSupportTickets.mockResolvedValue(1);

      const result = await service.getDeletionRequests();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].userId).toBe('user-456');
      expect(result.data[0].userEmail).toBe('delete@example.com');
      expect(result.data[0].userName).toBe('Delete User');
      expect(result.data[0].reasons).toEqual(['Too expensive', 'Not useful']);
      expect(result.data[0].notes).toBe('Please hurry');
      expect(result.data[0].isPermanent).toBe(true);
      expect(result.meta.total).toBe(1);
    });

    it('should handle ticket without reasons or notes', async () => {
      const ticketWithEmptyMessage = {
        ...mockDeletionTicket,
        message: '',
      };
      systemRepository.findSupportTickets.mockResolvedValue([
        ticketWithEmptyMessage as any,
      ]);
      systemRepository.countSupportTickets.mockResolvedValue(1);

      const result = await service.getDeletionRequests();

      expect(result.data[0].reasons).toEqual([]);
      expect(result.data[0].notes).toBe('');
      expect(result.data[0].isPermanent).toBe(false);
    });

    it('should handle non-permanent deletion request', async () => {
      const nonPermanentTicket = {
        ...mockDeletionTicket,
        message: 'Reasons: Not useful\nNotes: Just delete it',
      };
      systemRepository.findSupportTickets.mockResolvedValue([
        nonPermanentTicket as any,
      ]);
      systemRepository.countSupportTickets.mockResolvedValue(1);

      const result = await service.getDeletionRequests();

      expect(result.data[0].isPermanent).toBe(false);
      expect(result.data[0].reasons).toEqual(['Not useful']);
      expect(result.data[0].notes).toBe('Just delete it');
    });

    it('should apply pagination correctly', async () => {
      systemRepository.findSupportTickets.mockResolvedValue([]);
      systemRepository.countSupportTickets.mockResolvedValue(25);

      const result = await service.getDeletionRequests(3, 10);

      expect(systemRepository.findSupportTickets).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
          where: {
            subject: 'Delete Account Request',
            isDeleted: false,
          },
        }),
      );
      expect(result.meta.totalPages).toBe(3);
    });

    it('should handle empty deletion requests', async () => {
      systemRepository.findSupportTickets.mockResolvedValue([]);
      systemRepository.countSupportTickets.mockResolvedValue(0);

      const result = await service.getDeletionRequests();

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  // =====================
  // getElevenLabsBalance
  // =====================

  describe('getElevenLabsBalance', () => {
    it('should return subscription info from ElevenLabs provider', async () => {
      const subscriptionInfo = {
        tier: 'professional',
        characterCount: 5000,
        characterLimit: 50000,
      };
      elevenLabsProvider.getSubscriptionInfo.mockResolvedValue(
        subscriptionInfo as any,
      );

      const result = await service.getElevenLabsBalance();

      expect(result).toEqual(subscriptionInfo);
      expect(elevenLabsProvider.getSubscriptionInfo).toHaveBeenCalledTimes(1);
    });
  });

  // =====================
  // createBackup
  // =====================

  describe('createBackup', () => {
    it('should return backup success message with timestamp', () => {
      const result = service.createBackup();

      expect(result.message).toBe('Backup created successfully');
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  // =====================
  // seedDatabase
  // =====================

  describe('seedDatabase', () => {
    it('should seed database and return success message', async () => {
      const result = await service.seedDatabase();

      expect(result).toEqual({ message: 'Database seeded successfully' });
    });

    it('should upsert categories', async () => {
      await service.seedDatabase();

      // Verify category upsert was called (at least once for seed data)
      expect(prismaService.category.upsert).toHaveBeenCalled();
    });

    it('should create themes when they do not exist', async () => {
      prismaService.theme.findFirst.mockResolvedValue(null);

      await service.seedDatabase();

      expect(prismaService.theme.create).toHaveBeenCalled();
    });

    it('should update themes when they already exist', async () => {
      prismaService.theme.findFirst.mockResolvedValue({
        id: 'existing-theme',
        name: 'Friendship',
      });

      await service.seedDatabase();

      expect(prismaService.theme.update).toHaveBeenCalled();
    });

    it('should create age groups when they do not exist', async () => {
      prismaService.ageGroup.findFirst.mockResolvedValue(null);

      await service.seedDatabase();

      expect(prismaService.ageGroup.create).toHaveBeenCalled();
    });

    it('should update age groups when they already exist', async () => {
      prismaService.ageGroup.findFirst.mockResolvedValue({
        id: 'existing-age',
        name: '4-8',
      });

      await service.seedDatabase();

      expect(prismaService.ageGroup.update).toHaveBeenCalled();
    });

    it('should create avatars when they do not exist', async () => {
      prismaService.avatar.findFirst.mockResolvedValue(null);

      await service.seedDatabase();

      expect(prismaService.avatar.create).toHaveBeenCalled();
    });

    it('should update avatars when they already exist', async () => {
      prismaService.avatar.findFirst.mockResolvedValue({
        id: 'existing-avatar',
        name: 'Bear',
      });

      await service.seedDatabase();

      expect(prismaService.avatar.update).toHaveBeenCalled();
    });

    it('should invalidate caches after seeding', async () => {
      await service.seedDatabase();

      expect(mockCacheManager.del).toHaveBeenCalled();
    });

    it('should throw ValidationException when seeding fails', async () => {
      const dbError = new Error('Database error');
      prismaService.category.upsert.mockRejectedValue(dbError);
      prismaService.category.findFirst.mockRejectedValue(dbError);
      prismaService.category.create.mockRejectedValue(dbError);

      await expect(service.seedDatabase()).rejects.toThrow(ValidationException);
    });
  });
});
