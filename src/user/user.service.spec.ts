import { Test, TestingModule } from '@nestjs/testing';
import { UserService, SafeUser } from './user.service';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

// Mock pin utilities
jest.mock('./utils/pin.util', () => ({
  hashPin: jest.fn().mockResolvedValue('hashed_pin'),
  verifyPinHash: jest.fn(),
}));

import { hashPin, verifyPinHash } from './utils/pin.util';

// Type-safe mock for PrismaService
type MockPrismaService = {
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  session: {
    deleteMany: jest.Mock;
  };
  token: {
    deleteMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    delete: jest.Mock;
  };
  profile: {
    create: jest.Mock;
  };
  avatar: {
    create: jest.Mock;
  };
  kid: {
    count: jest.Mock;
  };
  activityLog: {
    create: jest.Mock;
  };
  supportTicket: {
    create: jest.Mock;
  };
  notificationPreference: {
    findMany: jest.Mock;
  };
};

const createMockPrismaService = (): MockPrismaService => ({
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  session: {
    deleteMany: jest.fn(),
  },
  token: {
    deleteMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
  profile: {
    create: jest.fn(),
  },
  avatar: {
    create: jest.fn(),
  },
  kid: {
    count: jest.fn(),
  },
  activityLog: {
    create: jest.fn(),
  },
  supportTicket: {
    create: jest.fn(),
  },
  notificationPreference: {
    findMany: jest.fn(),
  },
});

type MockNotificationService = {
  sendNotification: jest.Mock;
};

const createMockNotificationService = (): MockNotificationService => ({
  sendNotification: jest.fn(),
});

describe('UserService', () => {
  let service: UserService;
  let mockPrisma: MockPrismaService;
  let mockNotificationService: MockNotificationService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed_password',
    pinHash: null,
    isEmailVerified: true,
    isDeleted: false,
    deletedAt: null,
    role: 'parent',
    onboardingStatus: 'pin_setup',
    biometricsEnabled: false,
    profile: { language: 'en', country: 'US' },
    avatar: null,
    kids: [{ id: 'kid-1' }, { id: 'kid-2' }],
    subscriptions: [],
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockNotificationService = createMockNotificationService();

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotificationService },
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
        include: {
          profile: true,
          kids: true,
          avatar: true,
          subscriptions: true,
        },
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
        include: {
          profile: true,
          kids: true,
          avatar: true,
          subscriptions: true,
        },
      });
    });
  });

  // ==================== GET ALL USERS TESTS ====================

  describe('getAllUsers', () => {
    it('should return all users without sensitive fields', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.getAllUsers();

      expect(result).toHaveLength(1);
      expect((result[0] as SafeUser & { passwordHash?: string }).passwordHash).toBeUndefined();
      expect((result[0] as SafeUser & { pinHash?: string }).pinHash).toBeUndefined();
    });
  });

  describe('getActiveUsers', () => {
    it('should return only active (non-deleted) users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.getActiveUsers();

      expect(result).toHaveLength(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { isDeleted: false },
        include: { profile: true, avatar: true },
      });
    });
  });

  // ==================== DELETE USER TESTS ====================

  describe('deleteUser', () => {
    it('should soft delete user by default', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        isDeleted: true,
        deletedAt: new Date(),
      });

      const result = await service.deleteUser('user-1');

      expect(result.permanent).toBe(false);
      expect(result.message).toBe('Account deactivated successfully');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          isDeleted: true,
          deletedAt: expect.any(Date),
        },
      });
    });

    it('should permanently delete user when permanent=true', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.token.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.activityLog.create.mockResolvedValue({});
      mockPrisma.user.delete.mockResolvedValue(mockUser);

      const result = await service.deleteUser('user-1', true);

      expect(result.permanent).toBe(true);
      expect(result.message).toContain('permanently');
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should throw NotFoundException for non-existent user on permanent delete', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteUser('nonexistent', true)).rejects.toThrow(
        'Account not found',
      );
    });

    it('should handle Prisma P2025 error (record not found)', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        { code: 'P2025', clientVersion: '5.0.0' },
      );
      mockPrisma.user.update.mockRejectedValue(prismaError);

      await expect(service.deleteUser('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle Prisma P2003 error (foreign key constraint)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.token.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.activityLog.create.mockResolvedValue({});

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: '5.0.0' },
      );
      mockPrisma.user.delete.mockRejectedValue(prismaError);

      await expect(service.deleteUser('user-1', true)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==================== VERIFY PASSWORD AND LOG DELETION ====================

  describe('verifyPasswordAndLogDeletion', () => {
    it('should verify password and create support ticket', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.supportTicket.create.mockResolvedValue({ id: 'ticket-1' });

      const result = await service.verifyPasswordAndLogDeletion(
        'user-1',
        'password123',
        ['reason1'],
        'additional notes',
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.supportTicket.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyPasswordAndLogDeletion('nonexistent', 'password'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for already deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        isDeleted: true,
      });

      await expect(
        service.verifyPasswordAndLogDeletion('user-1', 'password'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.verifyPasswordAndLogDeletion('user-1', 'wrongpassword'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== RESTORE USER TESTS ====================

  describe('undoDeleteUser', () => {
    it('should restore soft-deleted user', async () => {
      const deletedUser = { ...mockUser, isDeleted: true };
      mockPrisma.user.findUnique.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        isDeleted: false,
        deletedAt: null,
      });
      mockPrisma.supportTicket.create.mockResolvedValue({});

      const result = await service.undoDeleteUser('user-1');

      expect(result.isDeleted).toBe(false);
      expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subject: 'Account Restoration',
        }),
      });
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.undoDeleteUser('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user is not deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.undoDeleteUser('user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('undoDeleteMyAccount', () => {
    it('should restore current user account', async () => {
      const deletedUser = { ...mockUser, isDeleted: true };
      mockPrisma.user.findUnique.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        isDeleted: false,
      });
      mockPrisma.supportTicket.create.mockResolvedValue({});

      const result = await service.undoDeleteMyAccount('user-1');

      expect(result.isDeleted).toBe(false);
    });
  });

  // ==================== UPDATE USER TESTS ====================

  describe('updateUser', () => {
    it('should update user name', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        name: 'Updated Name',
        kids: mockUser.kids,
      });

      const result = await service.updateUser('user-1', { name: 'Updated Name' });

      expect(result).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return existing user when no updates provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await service.updateUser('user-1', {});

      expect(result).toBeDefined();
    });

    it('should create new avatar when avatarUrl is provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);
      mockPrisma.avatar.create.mockResolvedValue({
        id: 'new-avatar-id',
        url: 'https://example.com/avatar.jpg',
      });
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarId: 'new-avatar-id',
        kids: mockUser.kids,
      });

      await service.updateUser('user-1', {
        avatarUrl: 'https://example.com/avatar.jpg',
      });

      expect(mockPrisma.avatar.create).toHaveBeenCalled();
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

      const result = await service.updateUserRole('user-1', 'admin' as any);

      expect(result.role).toBe('admin');
    });

    it('should throw error for invalid role', async () => {
      await expect(
        service.updateUserRole('user-1', 'invalid' as any),
      ).rejects.toThrow('Invalid role');
    });
  });

  // ==================== PIN TESTS ====================

  describe('setPin', () => {
    it('should set PIN successfully', async () => {
      const userWithProfileSetup = {
        ...mockUser,
        onboardingStatus: 'profile_setup',
      };
      mockPrisma.user.findUnique.mockResolvedValue(userWithProfileSetup);
      mockPrisma.user.update.mockResolvedValue({
        ...userWithProfileSetup,
        pinHash: 'hashed_pin',
        onboardingStatus: 'pin_setup',
      });

      const result = await service.setPin('user-1', '123456');

      expect(result.success).toBe(true);
      expect(hashPin).toHaveBeenCalledWith('123456');
    });

    it('should throw BadRequestException for invalid PIN format', async () => {
      await expect(service.setPin('user-1', '12345')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setPin('user-1', 'abcdef')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.setPin('nonexistent', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if profile not set up', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'email_verified',
      });

      await expect(service.setPin('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyPin', () => {
    it('should verify PIN successfully', async () => {
      const userWithPin = { ...mockUser, pinHash: 'hashed_pin' };
      mockPrisma.user.findUnique.mockResolvedValue(userWithPin);
      (verifyPinHash as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyPin('user-1', '123456');

      expect(result.success).toBe(true);
    });

    it('should throw BadRequestException if no PIN is set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.verifyPin('user-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for incorrect PIN', async () => {
      const userWithPin = { ...mockUser, pinHash: 'hashed_pin' };
      mockPrisma.user.findUnique.mockResolvedValue(userWithPin);
      (verifyPinHash as jest.Mock).mockResolvedValue(false);

      await expect(service.verifyPin('user-1', '000000')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==================== PIN RESET VIA OTP TESTS ====================

  describe('requestPinResetOtp', () => {
    it('should send PIN reset OTP', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.token.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.token.create.mockResolvedValue({ id: 'token-1' });
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });

      const result = await service.requestPinResetOtp('user-1');

      expect(result.message).toBe('Pin reset token sent');
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(
        'PinReset',
        expect.objectContaining({
          email: 'test@example.com',
          otp: expect.any(String),
        }),
      );
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.requestPinResetOtp('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('validatePinResetOtp', () => {
    it('should validate OTP successfully', async () => {
      const validToken = {
        id: 'token-1',
        expiresAt: new Date(Date.now() + 3600000),
      };
      mockPrisma.token.findFirst.mockResolvedValue(validToken);

      const result = await service.validatePinResetOtp('user-1', '123456');

      expect(result.success).toBe(true);
    });

    it('should throw BadRequestException for invalid OTP format', async () => {
      await expect(
        service.validatePinResetOtp('user-1', '12345'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid OTP', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(null);

      await expect(
        service.validatePinResetOtp('user-1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired OTP', async () => {
      const expiredToken = {
        id: 'token-1',
        expiresAt: new Date(Date.now() - 3600000),
      };
      mockPrisma.token.findFirst.mockResolvedValue(expiredToken);
      mockPrisma.token.delete.mockResolvedValue(expiredToken);

      await expect(
        service.validatePinResetOtp('user-1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPinWithOtp', () => {
    it('should reset PIN successfully', async () => {
      const validToken = {
        id: 'token-1',
        expiresAt: new Date(Date.now() + 3600000),
      };
      mockPrisma.token.findFirst.mockResolvedValue(validToken);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        pinHash: 'new_hashed_pin',
      });
      mockPrisma.token.delete.mockResolvedValue(validToken);

      const result = await service.resetPinWithOtp('user-1', '123456', '654321');

      expect(result.success).toBe(true);
    });

    it('should throw BadRequestException for invalid OTP format', async () => {
      await expect(
        service.resetPinWithOtp('user-1', '12345', '654321'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid PIN format', async () => {
      await expect(
        service.resetPinWithOtp('user-1', '123456', '12345'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if new PIN is same as old', async () => {
      const validToken = {
        id: 'token-1',
        expiresAt: new Date(Date.now() + 3600000),
      };
      const userWithPin = { ...mockUser, pinHash: 'hashed_pin' };
      mockPrisma.token.findFirst.mockResolvedValue(validToken);
      mockPrisma.user.findUnique.mockResolvedValue(userWithPin);
      (verifyPinHash as jest.Mock).mockResolvedValue(true);

      await expect(
        service.resetPinWithOtp('user-1', '123456', '123456'),
      ).rejects.toThrow(BadRequestException);
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

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateParentProfile('nonexistent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
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
