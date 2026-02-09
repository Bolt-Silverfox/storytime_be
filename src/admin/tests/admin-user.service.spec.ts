import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { AdminUserService } from '../admin-user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

describe('AdminUserService', () => {
  let service: AdminUserService;
  let mockPrisma: {
    user: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      updateMany: jest.Mock;
    };
    paymentTransaction: {
      aggregate: jest.Mock;
    };
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashedPassword123',
    pinHash: null,
    role: 'parent',
    isDeleted: false,
    deletedAt: null,
    isEmailVerified: true,
    onboardingStatus: 'completed',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  };

  const mockUserWithRelations = {
    ...mockUser,
    profile: { id: 'profile-1', country: 'NG' },
    avatar: { id: 'avatar-1', url: 'https://example.com/avatar.jpg' },
    subscriptions: [
      {
        id: 'sub-1',
        plan: 'monthly',
        status: 'active',
        endsAt: new Date(Date.now() + 86400000), // 1 day from now
      },
    ],
    usage: { elevenLabsCount: 50 },
    kids: [
      {
        id: 'kid-1',
        name: 'Kid 1',
        screenTimeSessions: [{ duration: 30 }, { duration: 45 }],
      },
    ],
    paymentTransactions: [{ amount: 100 }, { amount: 50 }],
    _count: {
      kids: 1,
      auth: 5,
      parentFavorites: 3,
      subscriptions: 1,
      paymentTransactions: 2,
    },
  };

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        updateMany: jest.fn(),
      },
      paymentTransaction: {
        aggregate: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AdminUserService>(AdminUserService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllUsers', () => {
    it('should return paginated users with default filters', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUserWithRelations]);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.getAllUsers({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockPrisma.user.findMany).toHaveBeenCalled();
      expect(mockPrisma.user.count).toHaveBeenCalled();
    });

    it('should apply search filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({ search: 'test@example.com' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { email: { contains: 'test@example.com', mode: 'insensitive' } },
              { name: { contains: 'test@example.com', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should filter by role', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({ role: Role.admin });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: Role.admin,
          }),
        }),
      );
    });

    it('should filter by email verification status', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({ isEmailVerified: true });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isEmailVerified: true,
          }),
        }),
      );
    });

    it('should filter by deletion status', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({ isDeleted: false });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDeleted: false,
          }),
        }),
      );
    });

    it('should filter by date range', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({
        createdAfter: '2024-01-01',
        createdBefore: '2024-12-31',
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          }),
        }),
      );
    });

    it('should filter by active subscription (true)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({ hasActiveSubscription: true });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptions: {
              some: expect.objectContaining({
                status: 'active',
                isDeleted: false,
              }),
            },
          }),
        }),
      );
    });

    it('should filter by no active subscription (false)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({ hasActiveSubscription: false });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: {
              subscriptions: {
                some: expect.objectContaining({
                  status: 'active',
                  isDeleted: false,
                }),
              },
            },
          }),
        }),
      );
    });

    it('should calculate metrics correctly', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUserWithRelations]);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.getAllUsers({});

      expect(result.data[0].creditUsed).toBe(50);
      expect(result.data[0].activityLength).toBe(75); // 30 + 45
      expect(result.data[0].amountSpent).toBe(150); // 100 + 50
      expect(result.data[0].isPaidUser).toBe(true);
      expect(result.data[0].kidsCount).toBe(1);
      expect(result.data[0].sessionsCount).toBe(5);
    });

    it('should exclude sensitive fields from response', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUserWithRelations]);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.getAllUsers({});

      expect(result.data[0]).not.toHaveProperty('passwordHash');
      expect(result.data[0]).not.toHaveProperty('pinHash');
    });

    it('should handle pagination correctly', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(25);

      const result = await service.getAllUsers({ page: 2, limit: 10 });

      expect(result.meta.totalPages).toBe(3);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should apply sorting', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getAllUsers({ sortBy: 'email', sortOrder: 'asc' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { email: 'asc' },
        }),
      );
    });
  });

  describe('getUserById', () => {
    const mockUserWithFullRelations = {
      ...mockUser,
      profile: { id: 'profile-1', country: 'NG' },
      avatar: { id: 'avatar-1', url: 'https://example.com/avatar.jpg' },
      kids: [
        {
          id: 'kid-1',
          name: 'Kid 1',
          ageRange: '4-6',
          createdAt: new Date(),
          avatar: null,
        },
      ],
      subscriptions: [
        {
          id: 'sub-1',
          status: 'active',
          endsAt: new Date(Date.now() + 86400000),
          startedAt: new Date(),
        },
      ],
      paymentTransactions: [{ id: 'txn-1', amount: 100, createdAt: new Date() }],
      _count: {
        auth: 10,
        parentFavorites: 5,
        voices: 2,
        subscriptions: 1,
        supportTickets: 3,
        paymentTransactions: 4,
      },
    };

    it('should return user with stats', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFullRelations);
      mockPrisma.paymentTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 500 },
      });

      const result = await service.getUserById('user-123');

      expect(result.id).toBe('user-123');
      expect(result.isPaidUser).toBe(true);
      expect(result.totalSpent).toBe(500);
      expect(result.stats).toEqual({
        sessionsCount: 10,
        favoritesCount: 5,
        voicesCount: 2,
        subscriptionsCount: 1,
        ticketsCount: 3,
        transactionsCount: 4,
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getUserById('nonexistent')).rejects.toThrow(
        'User with ID nonexistent not found',
      );
    });

    it('should exclude sensitive fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFullRelations);
      mockPrisma.paymentTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });

      const result = await service.getUserById('user-123');

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('pinHash');
    });

    it('should identify unpaid users correctly', async () => {
      const unpaidUser = {
        ...mockUserWithFullRelations,
        subscriptions: [], // No subscriptions
      };
      mockPrisma.user.findUnique.mockResolvedValue(unpaidUser);
      mockPrisma.paymentTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });

      const result = await service.getUserById('user-123');

      expect(result.isPaidUser).toBe(false);
    });

    it('should identify expired subscription as unpaid', async () => {
      const expiredSubUser = {
        ...mockUserWithFullRelations,
        subscriptions: [
          {
            id: 'sub-1',
            status: 'active',
            endsAt: new Date(Date.now() - 86400000), // 1 day ago
            startedAt: new Date(),
          },
        ],
      };
      mockPrisma.user.findUnique.mockResolvedValue(expiredSubUser);
      mockPrisma.paymentTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });

      const result = await service.getUserById('user-123');

      expect(result.isPaidUser).toBe(false);
    });

    it('should handle null totalSpent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserWithFullRelations);
      mockPrisma.paymentTransaction.aggregate.mockResolvedValue({
        _sum: { amount: null },
      });

      const result = await service.getUserById('user-123');

      expect(result.totalSpent).toBe(0);
    });
  });

  describe('createAdmin', () => {
    it('should create admin successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      mockPrisma.user.create.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@example.com',
        name: 'Admin User',
        role: Role.admin,
        createdAt: new Date(),
      });

      const result = await service.createAdmin({
        email: 'admin@example.com',
        password: 'securePassword123',
        name: 'Admin User',
      });

      expect(result.id).toBe('admin-123');
      expect(result.email).toBe('admin@example.com');
      expect(result.role).toBe(Role.admin);
      expect(bcrypt.hash).toHaveBeenCalledWith('securePassword123', 10);
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.createAdmin({
          email: 'test@example.com',
          password: 'password',
          name: 'Admin',
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.createAdmin({
          email: 'test@example.com',
          password: 'password',
          name: 'Admin',
        }),
      ).rejects.toThrow('User with this email already exists');
    });

    it('should create profile with default country', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      mockPrisma.user.create.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@example.com',
        name: 'Admin',
        role: Role.admin,
        createdAt: new Date(),
      });

      await service.createAdmin({
        email: 'admin@example.com',
        password: 'password',
        name: 'Admin',
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            profile: {
              create: {
                country: 'NG',
              },
            },
          }),
        }),
      );
    });

    it('should set isEmailVerified to true for admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      mockPrisma.user.create.mockResolvedValue({
        id: 'admin-123',
        email: 'admin@example.com',
        name: 'Admin',
        role: Role.admin,
        createdAt: new Date(),
      });

      await service.createAdmin({
        email: 'admin@example.com',
        password: 'password',
        name: 'Admin',
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isEmailVerified: true,
          }),
        }),
      );
    });
  });

  describe('updateUser', () => {
    it('should update user name', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Updated Name',
        role: 'parent',
        isEmailVerified: true,
        updatedAt: new Date(),
      });

      const result = await service.updateUser('user-123', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: expect.objectContaining({ name: 'Updated Name' }),
        }),
      );
    });

    it('should update user role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.admin,
        isEmailVerified: true,
        updatedAt: new Date(),
      });

      const result = await service.updateUser('user-123', { role: Role.admin });

      expect(result.role).toBe(Role.admin);
    });

    it('should update user email', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(mockUser) // First call: find user to update
        .mockResolvedValueOnce(null); // Second call: check if new email exists
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        email: 'newemail@example.com',
        name: 'Test User',
        role: 'parent',
        isEmailVerified: true,
        updatedAt: new Date(),
      });

      const result = await service.updateUser('user-123', {
        email: 'newemail@example.com',
      });

      expect(result.email).toBe('newemail@example.com');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser('nonexistent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if new email already exists', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(mockUser) // First call: find user to update (first expect)
        .mockResolvedValueOnce({ id: 'other-user', email: 'taken@example.com' }) // Second call: check email exists (first expect)
        .mockResolvedValueOnce(mockUser) // Third call: find user to update (second expect)
        .mockResolvedValueOnce({ id: 'other-user', email: 'taken@example.com' }); // Fourth call: check email exists (second expect)

      await expect(
        service.updateUser('user-123', { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.updateUser('user-123', { email: 'taken@example.com' }),
      ).rejects.toThrow('Email already in use');
    });

    it('should throw BadRequestException if admin tries to demote themselves', async () => {
      const adminUser = { ...mockUser, role: Role.admin };
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);

      await expect(
        service.updateUser('user-123', { role: Role.parent }, 'user-123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateUser('user-123', { role: Role.parent }, 'user-123'),
      ).rejects.toThrow('You cannot demote yourself from admin status');
    });

    it('should allow admin to change other users role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: Role.admin,
        isEmailVerified: true,
        updatedAt: new Date(),
      });

      const result = await service.updateUser(
        'user-123',
        { role: Role.admin },
        'admin-456', // Different admin
      );

      expect(result.role).toBe(Role.admin);
    });
  });

  describe('deleteUser', () => {
    it('should soft delete user by default', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'parent',
        isDeleted: true,
        deletedAt: new Date(),
      });

      const result = await service.deleteUser('user-123');

      expect(result.isDeleted).toBe(true);
      expect(result.deletedAt).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: {
            isDeleted: true,
            deletedAt: expect.any(Date),
          },
        }),
      );
    });

    it('should permanently delete user when permanent is true', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.delete.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'parent',
        isDeleted: true,
        deletedAt: null,
      });

      await service.deleteUser('user-123', true);

      expect(mockPrisma.user.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
        }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteUser('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if admin tries to delete themselves', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.deleteUser('user-123', false, 'user-123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.deleteUser('user-123', false, 'user-123'),
      ).rejects.toThrow('You cannot delete your own account');
    });

    it('should allow admin to delete other users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'parent',
        isDeleted: true,
        deletedAt: new Date(),
      });

      const result = await service.deleteUser('user-123', false, 'admin-456');

      expect(result.isDeleted).toBe(true);
    });
  });

  describe('restoreUser', () => {
    it('should restore a soft deleted user', async () => {
      const deletedUser = {
        ...mockUser,
        isDeleted: true,
        deletedAt: new Date(),
      };
      mockPrisma.user.findUnique.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'parent',
        isDeleted: false,
        deletedAt: null,
      });

      const result = await service.restoreUser('user-123');

      expect(result.isDeleted).toBe(false);
      expect(result.deletedAt).toBeNull();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-123' },
          data: {
            isDeleted: false,
            deletedAt: null,
          },
        }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.restoreUser('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.restoreUser('nonexistent')).rejects.toThrow(
        'User with ID nonexistent not found',
      );
    });
  });

  describe('bulkUserAction', () => {
    describe('delete action', () => {
      it('should soft delete multiple users', async () => {
        mockPrisma.user.updateMany.mockResolvedValue({ count: 3 });

        const result = await service.bulkUserAction({
          userIds: ['user-1', 'user-2', 'user-3'],
          action: 'delete',
        });

        expect(result.count).toBe(3);
        expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['user-1', 'user-2', 'user-3'] } },
          data: {
            isDeleted: true,
            deletedAt: expect.any(Date),
          },
        });
      });
    });

    describe('restore action', () => {
      it('should restore multiple users', async () => {
        mockPrisma.user.updateMany.mockResolvedValue({ count: 2 });

        const result = await service.bulkUserAction({
          userIds: ['user-1', 'user-2'],
          action: 'restore',
        });

        expect(result.count).toBe(2);
        expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['user-1', 'user-2'] } },
          data: {
            isDeleted: false,
            deletedAt: null,
          },
        });
      });
    });

    describe('verify action', () => {
      it('should verify email for multiple users', async () => {
        mockPrisma.user.updateMany.mockResolvedValue({ count: 5 });

        const result = await service.bulkUserAction({
          userIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
          action: 'verify',
        });

        expect(result.count).toBe(5);
        expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
          where: { id: { in: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'] } },
          data: {
            isEmailVerified: true,
          },
        });
      });
    });

    describe('invalid action', () => {
      it('should throw BadRequestException for invalid action', async () => {
        await expect(
          service.bulkUserAction({
            userIds: ['user-1'],
            action: 'invalid' as any,
          }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.bulkUserAction({
            userIds: ['user-1'],
            action: 'invalid' as any,
          }),
        ).rejects.toThrow('Invalid action');
      });
    });
  });
});
