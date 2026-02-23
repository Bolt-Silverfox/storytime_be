import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { UserDeletionService } from './user-deletion.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

describe('UserDeletionService', () => {
  let service: UserDeletionService;
  let mockPrisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    session: {
      deleteMany: jest.Mock;
    };
    token: {
      deleteMany: jest.Mock;
    };
    activityLog: {
      create: jest.Mock;
    };
    supportTicket: {
      create: jest.Mock;
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
    onboardingStatus: 'pin_setup',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserWithRelations = {
    ...mockUser,
    profile: { id: 'profile-1', userId: 'user-123', country: 'NG' },
    kids: [{ id: 'kid-1', name: 'Kid 1', parentId: 'user-123' }],
    avatar: { id: 'avatar-1', url: 'https://example.com/avatar.jpg' },
  };

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      session: {
        deleteMany: jest.fn(),
      },
      token: {
        deleteMany: jest.fn(),
      },
      activityLog: {
        create: jest.fn(),
      },
      supportTicket: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDeletionService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UserDeletionService>(UserDeletionService);
    jest.clearAllMocks();
  });

  describe('deleteUser', () => {
    describe('soft delete (default)', () => {
      it('should soft delete user successfully', async () => {
        const updatedUser = {
          ...mockUser,
          isDeleted: true,
          deletedAt: new Date(),
        };
        mockPrisma.user.update.mockResolvedValue(updatedUser);

        const result = await service.deleteUser('user-123');

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
          where: { id: 'user-123' },
          data: {
            isDeleted: true,
            deletedAt: expect.any(Date),
          },
        });
        expect(result).toMatchObject({
          message: 'Account deactivated successfully',
          permanent: false,
        });
      });

      it('should throw NotFoundException if user not found', async () => {
        const prismaError = new Prisma.PrismaClientKnownRequestError(
          'Record not found',
          { code: 'P2025', clientVersion: '5.0.0' },
        );
        mockPrisma.user.update.mockRejectedValue(prismaError);

        await expect(service.deleteUser('nonexistent')).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('permanent delete', () => {
      it('should permanently delete user and terminate sessions', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(mockUser);
        mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
        mockPrisma.token.deleteMany.mockResolvedValue({ count: 3 });
        mockPrisma.activityLog.create.mockResolvedValue({});
        mockPrisma.user.delete.mockResolvedValue(mockUser);

        const result = await service.deleteUser('user-123', true);

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
          where: { id: 'user-123' },
        });
        expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
          where: { userId: 'user-123' },
        });
        expect(mockPrisma.token.deleteMany).toHaveBeenCalledWith({
          where: { userId: 'user-123' },
        });
        expect(mockPrisma.activityLog.create).toHaveBeenCalledWith({
          data: {
            userId: 'user-123',
            action: 'SESSION_TERMINATION',
            status: 'SUCCESS',
            details:
              'All sessions terminated due to permanent account deletion',
            createdAt: expect.any(Date),
          },
        });
        expect(mockPrisma.user.delete).toHaveBeenCalledWith({
          where: { id: 'user-123' },
        });
        expect(result).toMatchObject({
          id: 'user-123',
          email: 'test@example.com',
          permanent: true,
        });
      });

      it('should throw BadRequestException with not found message if user not found for permanent delete', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(service.deleteUser('nonexistent', true)).rejects.toThrow(
          BadRequestException,
        );
        await expect(service.deleteUser('nonexistent', true)).rejects.toThrow(
          'Account not found',
        );
        expect(mockPrisma.user.delete).not.toHaveBeenCalled();
      });

      it('should throw BadRequestException on foreign key constraint error', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(mockUser);
        mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.token.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.activityLog.create.mockResolvedValue({});

        const prismaError = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint',
          { code: 'P2003', clientVersion: '5.0.0' },
        );
        mockPrisma.user.delete.mockRejectedValue(prismaError);

        await expect(service.deleteUser('user-123', true)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('should log failure if session termination fails but continue with deletion', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(mockUser);
        mockPrisma.session.deleteMany.mockRejectedValue(new Error('DB error'));
        mockPrisma.activityLog.create.mockResolvedValue({});
        mockPrisma.user.delete.mockResolvedValue(mockUser);

        const result = await service.deleteUser('user-123', true);

        // Should have logged failure
        expect(mockPrisma.activityLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            action: 'SESSION_TERMINATION',
            status: 'FAILED',
          }),
        });
        // But still delete the user
        expect(mockPrisma.user.delete).toHaveBeenCalled();
        expect(result.permanent).toBe(true);
      });
    });
  });

  describe('deleteUserAccount', () => {
    it('should delegate to deleteUser', async () => {
      const updatedUser = {
        ...mockUser,
        isDeleted: true,
        deletedAt: new Date(),
      };
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.deleteUserAccount('user-123');

      expect(result).toMatchObject({
        message: 'Account deactivated successfully',
        permanent: false,
      });
    });
  });

  describe('verifyPasswordAndLogDeletion', () => {
    it('should verify password and create support ticket', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.supportTicket.create.mockResolvedValue({});

      const result = await service.verifyPasswordAndLogDeletion(
        'user-123',
        'correctPassword',
        ['Too expensive', 'Not using anymore'],
        'Additional notes here',
        false,
      );

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'correctPassword',
        'hashedPassword123',
      );
      expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          subject: 'Delete Account Request',
          message: expect.stringContaining('Deletion request submitted'),
        },
      });
      expect(result).toEqual({
        success: true,
        message: 'Password verified. Account deletion request submitted.',
      });
    });

    it('should include warning for permanent deletion request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.supportTicket.create.mockResolvedValue({});

      await service.verifyPasswordAndLogDeletion(
        'user-123',
        'correctPassword',
        undefined,
        undefined,
        true,
      );

      expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          subject: 'Delete Account Request',
          message: expect.stringContaining('WARNING'),
        },
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyPasswordAndLogDeletion('nonexistent', 'password'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user is already deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        isDeleted: true,
      });

      await expect(
        service.verifyPasswordAndLogDeletion('user-123', 'password'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.verifyPasswordAndLogDeletion('user-123', 'password'),
      ).rejects.toThrow('Account is already deactivated');
    });

    it('should throw BadRequestException if password is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.verifyPasswordAndLogDeletion('user-123', 'wrongPassword'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.verifyPasswordAndLogDeletion('user-123', 'wrongPassword'),
      ).rejects.toThrow('Invalid password');
    });
  });

  describe('undoDeleteUser', () => {
    it('should restore a soft deleted user', async () => {
      const deletedUser = {
        ...mockUser,
        isDeleted: true,
        deletedAt: new Date(),
      };
      mockPrisma.user.findUnique.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(mockUserWithRelations);
      mockPrisma.supportTicket.create.mockResolvedValue({});

      const result = await service.undoDeleteUser('user-123');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          isDeleted: false,
          deletedAt: null,
        },
        include: { profile: true, kids: true, avatar: true },
      });
      expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          subject: 'Account Restoration',
          message: expect.stringContaining('Account restored by admin'),
        },
      });
      expect(result).toEqual(mockUserWithRelations);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.undoDeleteUser('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user is not deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.undoDeleteUser('user-123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.undoDeleteUser('user-123')).rejects.toThrow(
        'User is not deleted',
      );
    });
  });

  describe('undoDeleteMyAccount', () => {
    it('should restore own soft deleted account', async () => {
      const deletedUser = {
        ...mockUser,
        isDeleted: true,
        deletedAt: new Date(),
      };
      mockPrisma.user.findUnique.mockResolvedValue(deletedUser);
      mockPrisma.user.update.mockResolvedValue(mockUserWithRelations);
      mockPrisma.supportTicket.create.mockResolvedValue({});

      const result = await service.undoDeleteMyAccount('user-123');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          isDeleted: false,
          deletedAt: null,
        },
        include: { profile: true, kids: true, avatar: true },
      });
      expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          subject: 'Account Self-Restoration',
          message: expect.stringContaining('User restored their own account'),
        },
      });
      expect(result).toEqual(mockUserWithRelations);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.undoDeleteMyAccount('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if account is not deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.undoDeleteMyAccount('user-123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.undoDeleteMyAccount('user-123')).rejects.toThrow(
        'Your account is not deleted',
      );
    });
  });
});
