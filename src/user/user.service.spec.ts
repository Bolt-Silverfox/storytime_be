import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import type { SafeUser } from './user.service';
import { UserRole } from './user.controller';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ResourceNotFoundException,
  InvalidRoleException,
} from '@/shared/exceptions';

// Type-safe mock for PrismaService
type MockPrismaService = {
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  avatar: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

const createMockPrismaService = (): MockPrismaService => ({
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  avatar: {
    create: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn({
    user: { update: jest.fn() },
    avatar: { create: jest.fn() },
  })),
});

describe('UserService', () => {
  let service: UserService;
  let mockPrisma: MockPrismaService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    isEmailVerified: true,
    isDeleted: false,
    deletedAt: null,
    role: 'parent',
    onboardingStatus: 'pin_setup',
    biometricsEnabled: false,
    profile: { language: 'en', country: 'US' },
    avatar: null,
    kids: [{ id: 'kid-1' }, { id: 'kid-2' }],
    subscription: [],
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== GET USER TESTS ====================

  describe('getUser', () => {
    it('should return user with numberOfKids', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUser('user-1');

      expect(result).toBeDefined();
      expect(result?.numberOfKids).toBe(2);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1', isDeleted: false },
        select: expect.objectContaining({
          id: true,
          email: true,
          profile: true,
          kids: true,
          avatar: true,
          subscription: true,
        }),
      });
    });

    it('should return null for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getUser('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getUserIncludingDeleted', () => {
    it('should return deleted user', async () => {
      const deletedUser = { ...mockUser, isDeleted: true };
      mockPrisma.user.findUnique.mockResolvedValue(deletedUser);

      const result = await service.getUserIncludingDeleted('user-1');

      expect(result).toBeDefined();
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.objectContaining({
          id: true,
          email: true,
          profile: true,
          kids: true,
          avatar: true,
          subscription: true,
        }),
      });
    });
  });

  // ==================== GET ALL USERS TESTS ====================

  describe('getAllUsers', () => {
    it('should return all users without sensitive fields', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.getAllUsers();

      expect(result).toHaveLength(1);
      expect(
        (result[0] as SafeUser & { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
      expect(
        (result[0] as SafeUser & { pinHash?: string }).pinHash,
      ).toBeUndefined();
    });
  });

  describe('getActiveUsers', () => {
    it('should return only active (non-deleted) users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.getActiveUsers();

      expect(result).toHaveLength(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { isDeleted: false },
        select: expect.objectContaining({
          id: true,
          email: true,
          profile: true,
          avatar: true,
        }),
      });
    });
  });

  // ==================== UPDATE USER TESTS ====================

  describe('updateUser', () => {
    it('should update user name', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      const updatedUser = { ...mockUser, name: 'Updated Name' };
      mockPrisma.$transaction.mockResolvedValue({
        ...updatedUser,
        numberOfKids: 2,
      });

      const result = await service.updateUser('user-1', {
        name: 'Updated Name',
      });

      expect(result).toBeDefined();
    });

    it('should throw ResourceNotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should return existing user when no updates provided', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(mockUser);

      const result = await service.updateUser('user-1', {});

      expect(result).toBeDefined();
    });

    it('should create new avatar when avatarUrl is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      const txMock = {
        avatar: {
          create: jest.fn().mockResolvedValue({
            id: 'new-avatar-id',
            url: 'https://example.com/avatar.jpg',
          }),
        },
        user: {
          update: jest.fn().mockResolvedValue({
            ...mockUser,
            avatarId: 'new-avatar-id',
            kids: mockUser.kids,
          }),
        },
      };
      mockPrisma.$transaction.mockImplementation((fn) => fn(txMock));

      await service.updateUser('user-1', {
        avatarUrl: 'https://example.com/avatar.jpg',
      });

      expect(txMock.avatar.create).toHaveBeenCalled();
    });
  });

  // ==================== USER ROLE TESTS ====================

  describe('getUserRole', () => {
    it('should return user role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserRole('user-1');

      expect(result.role).toBe('parent');
    });
  });

  describe('updateUserRole', () => {
    it('should update user role', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        role: 'admin',
      });

      const result = await service.updateUserRole('user-1', UserRole.ADMIN);

      expect(result.role).toBe('admin');
    });

    it('should throw error for invalid role', async () => {
      await expect(
        service.updateUserRole('user-1', 'invalid' as UserRole),
      ).rejects.toThrow(InvalidRoleException);
    });
  });

  // ==================== PARENT PROFILE TESTS ====================

  describe('updateParentProfile', () => {
    it('should update parent profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        name: 'Updated Name',
      });

      const result = await service.updateParentProfile('user-1', {
        name: 'Updated Name',
      });

      expect(result).toBeDefined();
    });

    it('should throw ResourceNotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateParentProfile('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });

  describe('updateAvatarForParent', () => {
    it('should update avatar for parent', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarId: 'new-avatar-id',
        avatar: { id: 'new-avatar-id', url: 'https://example.com/avatar.jpg' },
      });

      const result = await service.updateAvatarForParent('user-1', {
        avatarId: 'new-avatar-id',
      });

      expect(result.avatarId).toBe('new-avatar-id');
    });
  });
});
