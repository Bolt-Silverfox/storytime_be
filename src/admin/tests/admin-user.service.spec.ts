import { Test, TestingModule } from '@nestjs/testing';
import {
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
  ValidationException,
  ForbiddenActionException,
  ConflictException,
} from '@/shared/exceptions';
import { AdminUserService } from '../admin-user.service';
import {
  ADMIN_USER_REPOSITORY,
  IAdminUserRepository,
} from '../repositories/admin-user.repository.interface';
import { PasswordService } from '../../auth/services/password.service';

describe('AdminUserService', () => {
  let service: AdminUserService;
  let adminUserRepository: jest.Mocked<IAdminUserRepository>;
  let passwordService: jest.Mocked<PasswordService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashedPassword123',
    pinHash: null,
    role: 'parent',
    isDeleted: false,
    deletedAt: null,
    isSuspended: false,
    suspendedAt: null,
    isEmailVerified: true,
    onboardingStatus: 'completed',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  const mockUserWithRelations = {
    ...mockUser,
    profile: { id: 'profile-1', country: 'NG' },
    avatar: { id: 'avatar-1', url: 'https://example.com/avatar.jpg' },
    kids: [{ id: 'kid-1', name: 'Kid 1' }],
    subscription: null,
    _count: {
      kids: 1,
      auth: 10,
      parentFavorites: 5,
      voices: 2,
      subscriptions: 0,
      supportTickets: 3,
      paymentTransactions: 4,
    },
    creditUsed: 0,
    activityLength: 0,
    amountSpent: 0,
    isPaidUser: false,
    kidsCount: 1,
    sessionsCount: 0,
  };

  /** Helper to build a findUsers-compatible user row with kids/payment/usage/subscription */
  const makeListUser = (overrides: Record<string, any> = {}) => ({
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashedPassword123',
    pinHash: null,
    role: 'parent',
    isDeleted: false,
    deletedAt: null,
    isSuspended: false,
    suspendedAt: null,
    isEmailVerified: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    kids: [
      {
        id: 'kid-1',
        screenTimeSessions: [{ duration: 120 }],
      },
    ],
    paymentTransactions: [{ amount: 50 }],
    usage: { elevenLabsCount: 3 },
    subscription: null,
    _count: {
      kids: 1,
      auth: 10,
      parentFavorites: 5,
      paymentTransactions: 1,
    },
    ...overrides,
  });

  beforeEach(async () => {
    const mockAdminUserRepository = {
      findUsers: jest.fn(),
      countUsers: jest.fn(),
      findUserById: jest.fn(),
      findUserByIdSimple: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      softDeleteUser: jest.fn(),
      hardDeleteUser: jest.fn(),
      restoreUser: jest.fn(),
      bulkSoftDeleteUsers: jest.fn(),
      bulkRestoreUsers: jest.fn(),
      bulkVerifyUsers: jest.fn(),
      findUserByEmail: jest.fn(),
      userExistsByEmail: jest.fn(),
      aggregatePaymentTransactions: jest.fn(),
    };

    const mockPasswordService = {
      hashPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserService,
        {
          provide: ADMIN_USER_REPOSITORY,
          useValue: mockAdminUserRepository,
        },
        {
          provide: PasswordService,
          useValue: mockPasswordService,
        },
      ],
    }).compile();

    service = module.get<AdminUserService>(AdminUserService);
    adminUserRepository = module.get(ADMIN_USER_REPOSITORY);
    passwordService = module.get(PasswordService);
    jest.clearAllMocks();
  });

  // ─── getUserById ────────────────────────────────────────────────────
  describe('getUserById', () => {
    it('should return user details', async () => {
      adminUserRepository.findUserById.mockResolvedValue(
        mockUserWithRelations as any,
      );
      adminUserRepository.aggregatePaymentTransactions.mockResolvedValue({
        _sum: { amount: 100 },
      });

      const result = await service.getUserById('user-123');

      expect(result.id).toBe('user-123');
      expect(result.totalSpent).toBe(100);
    });

    it('should throw NotFoundException if user not found', async () => {
      adminUserRepository.findUserById.mockResolvedValue(null);

      await expect(service.getUserById('nonexistent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ─── createAdmin ────────────────────────────────────────────────────
  describe('createAdmin', () => {
    it('should create admin successfully', async () => {
      adminUserRepository.findUserByEmail.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashedPassword');
      adminUserRepository.createUser.mockResolvedValue(mockUser as any);

      const result = await service.createAdmin({
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
      });

      expect(result.id).toBe('user-123');
      expect(passwordService.hashPassword).toHaveBeenCalled();
    });

    it('should throw ResourceAlreadyExistsException if email is taken', async () => {
      adminUserRepository.findUserByEmail.mockResolvedValue(mockUser as any);

      await expect(
        service.createAdmin({
          email: 'test@example.com',
          password: 'password123',
          name: 'Admin',
        }),
      ).rejects.toThrow(ResourceAlreadyExistsException);
    });
  });

  // ─── getAllUsers ────────────────────────────────────────────────────
  describe('getAllUsers', () => {
    it('should return paginated users with defaults', async () => {
      const listUser = makeListUser();
      adminUserRepository.findUsers.mockResolvedValue([listUser] as any);
      adminUserRepository.countUsers.mockResolvedValue(1);

      const result = await service.getAllUsers({});

      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('user-123');
      expect(adminUserRepository.findUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should apply search filter on email and name', async () => {
      adminUserRepository.findUsers.mockResolvedValue([]);
      adminUserRepository.countUsers.mockResolvedValue(0);

      await service.getAllUsers({ search: 'john' });

      const call = adminUserRepository.findUsers.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { email: { contains: 'john', mode: 'insensitive' } },
        { name: { contains: 'john', mode: 'insensitive' } },
      ]);
    });

    it('should apply role filter', async () => {
      adminUserRepository.findUsers.mockResolvedValue([]);
      adminUserRepository.countUsers.mockResolvedValue(0);

      await service.getAllUsers({ role: 'admin' as any });

      const call = adminUserRepository.findUsers.mock.calls[0][0];
      expect(call.where.role).toBe('admin');
    });

    it('should apply isEmailVerified filter', async () => {
      adminUserRepository.findUsers.mockResolvedValue([]);
      adminUserRepository.countUsers.mockResolvedValue(0);

      await service.getAllUsers({ isEmailVerified: true });

      const call = adminUserRepository.findUsers.mock.calls[0][0];
      expect(call.where.isEmailVerified).toBe(true);
    });

    it('should apply date range filters', async () => {
      adminUserRepository.findUsers.mockResolvedValue([]);
      adminUserRepository.countUsers.mockResolvedValue(0);

      await service.getAllUsers({
        createdAfter: '2024-01-01',
        createdBefore: '2024-06-01',
      });

      const call = adminUserRepository.findUsers.mock.calls[0][0];
      expect(call.where.createdAt).toEqual({
        gte: new Date('2024-01-01'),
        lte: new Date('2024-06-01'),
      });
    });

    it('should handle custom pagination and sorting', async () => {
      adminUserRepository.findUsers.mockResolvedValue([]);
      adminUserRepository.countUsers.mockResolvedValue(25);

      const result = await service.getAllUsers({
        page: 3,
        limit: 5,
        sortBy: 'email',
        sortOrder: 'asc',
      });

      expect(adminUserRepository.findUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 5,
          orderBy: { email: 'asc' },
        }),
      );
      expect(result.meta.totalPages).toBe(5);
    });

    it('should compute user metrics correctly', async () => {
      const listUser = makeListUser({
        kids: [
          {
            id: 'kid-1',
            screenTimeSessions: [{ duration: 100 }, { duration: 200 }],
          },
          {
            id: 'kid-2',
            screenTimeSessions: [{ duration: 50 }],
          },
        ],
        paymentTransactions: [{ amount: 10 }, { amount: 20 }],
        usage: { elevenLabsCount: 7 },
        subscription: { id: 'sub-1', status: 'active' },
        _count: {
          kids: 2,
          auth: 5,
          parentFavorites: 3,
          paymentTransactions: 2,
        },
      });

      adminUserRepository.findUsers.mockResolvedValue([listUser] as any);
      adminUserRepository.countUsers.mockResolvedValue(1);

      const result = await service.getAllUsers({});
      const user = result.data[0];

      expect(user.activityLength).toBe(350); // 100 + 200 + 50
      expect(user.amountSpent).toBe(30); // 10 + 20
      expect(user.creditUsed).toBe(7);
      expect(user.isPaidUser).toBe(true);
      expect(user.kidsCount).toBe(2);
      expect(user.sessionsCount).toBe(5);
      expect(user.favoritesCount).toBe(3);
      expect(user.transactionsCount).toBe(2);
      expect(user.subscriptionsCount).toBe(1);
    });

    it('should strip sensitive fields from response', async () => {
      const listUser = makeListUser();
      adminUserRepository.findUsers.mockResolvedValue([listUser] as any);
      adminUserRepository.countUsers.mockResolvedValue(1);

      const result = await service.getAllUsers({});
      const user = result.data[0];

      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('pinHash');
    });
  });

  // ─── updateUser ─────────────────────────────────────────────────────
  describe('updateUser', () => {
    it('should update user successfully', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );
      adminUserRepository.updateUser.mockResolvedValue({
        ...mockUser,
        name: 'Updated Name',
      } as any);

      const result = await service.updateUser('user-123', {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(adminUserRepository.updateUser).toHaveBeenCalledWith({
        userId: 'user-123',
        data: { name: 'Updated Name' },
      });
    });

    it('should prevent self-demotion from admin', async () => {
      await expect(
        service.updateUser('admin-1', { role: 'parent' as any }, 'admin-1'),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ResourceNotFoundException if user not found', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(null);

      await expect(
        service.updateUser('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should throw ResourceAlreadyExistsException if new email is taken', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );
      adminUserRepository.findUserByEmail.mockResolvedValue({
        ...mockUser,
        id: 'other-user',
        email: 'taken@example.com',
      } as any);

      await expect(
        service.updateUser('user-123', { email: 'taken@example.com' }),
      ).rejects.toThrow(ResourceAlreadyExistsException);
    });

    it('should allow updating email when it matches current email', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );
      adminUserRepository.updateUser.mockResolvedValue(mockUser as any);

      await service.updateUser('user-123', { email: 'test@example.com' });

      // findUserByEmail should NOT be called because email matches current
      expect(adminUserRepository.findUserByEmail).not.toHaveBeenCalled();
    });

    it('should allow admin role update for a different user', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );
      adminUserRepository.updateUser.mockResolvedValue({
        ...mockUser,
        role: 'admin',
      } as any);

      const result = await service.updateUser(
        'user-123',
        { role: 'admin' as any },
        'admin-different',
      );

      expect(result.role).toBe('admin');
    });
  });

  // ─── deleteUser ─────────────────────────────────────────────────────
  describe('deleteUser', () => {
    it('should soft delete user by default', async () => {
      const deletedUser = {
        ...mockUser,
        isDeleted: true,
        deletedAt: new Date(),
      };
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );
      adminUserRepository.softDeleteUser.mockResolvedValue(
        deletedUser as any,
      );

      const result = await service.deleteUser('user-123');

      expect(result.isDeleted).toBe(true);
      expect(adminUserRepository.softDeleteUser).toHaveBeenCalledWith(
        'user-123',
      );
      expect(adminUserRepository.hardDeleteUser).not.toHaveBeenCalled();
    });

    it('should hard delete user when permanent is true', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );
      adminUserRepository.hardDeleteUser.mockResolvedValue(mockUser as any);

      await service.deleteUser('user-123', true);

      expect(adminUserRepository.hardDeleteUser).toHaveBeenCalledWith(
        'user-123',
      );
      expect(adminUserRepository.softDeleteUser).not.toHaveBeenCalled();
    });

    it('should prevent self-deletion', async () => {
      await expect(
        service.deleteUser('admin-1', false, 'admin-1'),
      ).rejects.toThrow(ValidationException);
    });

    it('should throw ResourceNotFoundException if user not found', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(null);

      await expect(service.deleteUser('nonexistent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ─── restoreUser ────────────────────────────────────────────────────
  describe('restoreUser', () => {
    it('should restore a deleted user', async () => {
      const deletedUser = {
        ...mockUser,
        isDeleted: true,
        deletedAt: new Date(),
      };
      const restoredUser = {
        ...mockUser,
        isDeleted: false,
        deletedAt: null,
      };
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        deletedUser as any,
      );
      adminUserRepository.restoreUser.mockResolvedValue(restoredUser as any);

      const result = await service.restoreUser('user-123');

      expect(result.isDeleted).toBe(false);
      expect(result.deletedAt).toBeNull();
      expect(adminUserRepository.restoreUser).toHaveBeenCalledWith(
        'user-123',
      );
    });

    it('should throw ResourceNotFoundException if user not found', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(null);

      await expect(service.restoreUser('nonexistent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ─── suspendUser ────────────────────────────────────────────────────
  describe('suspendUser', () => {
    it('should suspend a regular user', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );
      adminUserRepository.updateUser.mockResolvedValue({
        ...mockUser,
        isSuspended: true,
        suspendedAt: new Date(),
      } as any);

      const result = await service.suspendUser('user-123');

      expect((result as any).isSuspended).toBe(true);
      expect(adminUserRepository.updateUser).toHaveBeenCalledWith({
        userId: 'user-123',
        data: { isSuspended: true, suspendedAt: expect.any(Date) },
      });
    });

    it('should throw ForbiddenActionException when suspending an admin', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue({
        ...mockUser,
        role: 'admin',
      } as any);

      await expect(service.suspendUser('user-123')).rejects.toThrow(
        ForbiddenActionException,
      );
    });

    it('should throw ConflictException when user is already suspended', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue({
        ...mockUser,
        isSuspended: true,
      } as any);

      await expect(service.suspendUser('user-123')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ResourceNotFoundException if user not found', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(null);

      await expect(service.suspendUser('nonexistent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ─── unsuspendUser ──────────────────────────────────────────────────
  describe('unsuspendUser', () => {
    it('should unsuspend a suspended user', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue({
        ...mockUser,
        isSuspended: true,
      } as any);
      adminUserRepository.updateUser.mockResolvedValue({
        ...mockUser,
        isSuspended: false,
        suspendedAt: null,
      } as any);

      const result = await service.unsuspendUser('user-123');

      expect((result as any).isSuspended).toBe(false);
      expect(adminUserRepository.updateUser).toHaveBeenCalledWith({
        userId: 'user-123',
        data: { isSuspended: false, suspendedAt: null },
      });
    });

    it('should throw ConflictException when user is not suspended', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(
        mockUser as any,
      );

      await expect(service.unsuspendUser('user-123')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ResourceNotFoundException if user not found', async () => {
      adminUserRepository.findUserByIdSimple.mockResolvedValue(null);

      await expect(service.unsuspendUser('nonexistent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ─── bulkUserAction ─────────────────────────────────────────────────
  describe('bulkUserAction', () => {
    const userIds = ['user-1', 'user-2', 'user-3'];

    it('should bulk soft-delete users', async () => {
      adminUserRepository.bulkSoftDeleteUsers.mockResolvedValue({ count: 3 });

      const result = await service.bulkUserAction({
        userIds,
        action: 'delete',
      });

      expect(result.count).toBe(3);
      expect(adminUserRepository.bulkSoftDeleteUsers).toHaveBeenCalledWith(
        userIds,
      );
    });

    it('should bulk restore users', async () => {
      adminUserRepository.bulkRestoreUsers.mockResolvedValue({ count: 3 });

      const result = await service.bulkUserAction({
        userIds,
        action: 'restore',
      });

      expect(result.count).toBe(3);
      expect(adminUserRepository.bulkRestoreUsers).toHaveBeenCalledWith(
        userIds,
      );
    });

    it('should bulk verify users', async () => {
      adminUserRepository.bulkVerifyUsers.mockResolvedValue({ count: 3 });

      const result = await service.bulkUserAction({
        userIds,
        action: 'verify',
      });

      expect(result.count).toBe(3);
      expect(adminUserRepository.bulkVerifyUsers).toHaveBeenCalledWith(
        userIds,
      );
    });

    it('should throw ValidationException for invalid action', async () => {
      await expect(
        service.bulkUserAction({
          userIds,
          action: 'invalid' as any,
        }),
      ).rejects.toThrow(ValidationException);
    });
  });

  // ─── exportUsersAsCsv ──────────────────────────────────────────────
  describe('exportUsersAsCsv', () => {
    it('should generate CSV with headers and user rows', async () => {
      const csvUser = {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'parent',
        isEmailVerified: true,
        isSuspended: false,
        createdAt: new Date('2024-06-15T00:00:00.000Z'),
      };
      adminUserRepository.findUsers.mockResolvedValueOnce([csvUser] as any);
      // Second call returns empty to stop chunking loop
      adminUserRepository.findUsers.mockResolvedValueOnce([]);

      const result = await service.exportUsersAsCsv();
      const lines = result.split('\n');

      expect(lines[0]).toBe('ID,Email,Name,Role,Verified,Created,Suspended');
      expect(lines[1]).toBe(
        'user-1,user@example.com,Test User,parent,Yes,2024-06-15T00:00:00.000Z,No',
      );
      expect(lines).toHaveLength(2);
    });

    it('should return only headers when no users exist', async () => {
      adminUserRepository.findUsers.mockResolvedValue([]);

      const result = await service.exportUsersAsCsv();
      const lines = result.split('\n');

      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('ID,Email,Name,Role,Verified,Created,Suspended');
    });

    it('should sanitize CSV values starting with dangerous characters', async () => {
      const csvUser = {
        id: 'user-2',
        email: '=cmd@example.com',
        name: '+malicious',
        role: 'parent',
        isEmailVerified: false,
        isSuspended: true,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      };
      adminUserRepository.findUsers.mockResolvedValueOnce([csvUser] as any);
      adminUserRepository.findUsers.mockResolvedValueOnce([]);

      const result = await service.exportUsersAsCsv();
      const lines = result.split('\n');

      // Dangerous chars should be prefixed with a tab
      expect(lines[1]).toContain('\t=cmd@example.com');
      expect(lines[1]).toContain('\t+malicious');
    });

    it('should paginate through chunks of users', async () => {
      // Simulate exactly CHUNK_SIZE (1000) users on first call to trigger a second fetch
      const usersChunk = Array.from({ length: 1000 }, (_, i) => ({
        id: `user-${i}`,
        email: `user${i}@example.com`,
        name: `User ${i}`,
        role: 'parent',
        isEmailVerified: true,
        isSuspended: false,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      }));
      adminUserRepository.findUsers.mockResolvedValueOnce(usersChunk as any);
      adminUserRepository.findUsers.mockResolvedValueOnce([]);

      const result = await service.exportUsersAsCsv();
      const lines = result.split('\n');

      // 1 header + 1000 data rows
      expect(lines).toHaveLength(1001);
      expect(adminUserRepository.findUsers).toHaveBeenCalledTimes(2);
      // Second call should have skip=1000
      expect(adminUserRepository.findUsers).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ skip: 1000 }),
      );
    });
  });
});
