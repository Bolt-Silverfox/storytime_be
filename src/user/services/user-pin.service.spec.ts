import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserPinService } from './user-pin.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import * as pinUtil from '../utils/pin.util';

// Mock pin utilities
jest.mock('../utils/pin.util', () => ({
  hashPin: jest.fn(),
  verifyPinHash: jest.fn(),
}));

describe('UserPinService', () => {
  let service: UserPinService;
  let mockPrisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    token: {
      deleteMany: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
  };
  let mockNotificationService: {
    sendNotification: jest.Mock;
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashedPassword123',
    pinHash: 'hashedPin123',
    role: 'parent',
    isDeleted: false,
    deletedAt: null,
    isEmailVerified: true,
    onboardingStatus: 'profile_setup',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      token: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };

    mockNotificationService = {
      sendNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPinService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<UserPinService>(UserPinService);
    jest.clearAllMocks();
  });

  describe('setPin', () => {
    it('should set PIN successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        pinHash: 'newHashedPin',
        onboardingStatus: 'pin_setup',
      });

      const result = await service.setPin('user-123', '123456');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123', isDeleted: false },
      });
      expect(pinUtil.hashPin).toHaveBeenCalledWith('123456');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123', isDeleted: false },
        data: { pinHash: 'newHashedPin', onboardingStatus: 'pin_setup' },
      });
      expect(result).toEqual({ success: true, message: 'PIN set successfully' });
    });

    it('should throw BadRequestException if PIN is not 6 digits', async () => {
      await expect(service.setPin('user-123', '12345')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setPin('user-123', '12345')).rejects.toThrow(
        'PIN must be exactly 6 digits',
      );

      await expect(service.setPin('user-123', '1234567')).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.setPin('user-123', 'abcdef')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.setPin('nonexistent', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if onboarding not at profile_setup stage', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        onboardingStatus: 'email_verified',
      });

      await expect(service.setPin('user-123', '123456')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.setPin('user-123', '123456')).rejects.toThrow(
        'Complete profile setup before setting PIN',
      );
    });
  });

  describe('verifyPin', () => {
    it('should verify PIN successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyPin('user-123', '123456');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123', isDeleted: false },
      });
      expect(pinUtil.verifyPinHash).toHaveBeenCalledWith('123456', 'hashedPin123');
      expect(result).toEqual({ success: true, message: 'PIN verified successfully' });
    });

    it('should throw BadRequestException if no PIN is set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        pinHash: null,
      });

      await expect(service.verifyPin('user-123', '123456')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.verifyPin('user-123', '123456')).rejects.toThrow(
        'No PIN is set',
      );
    });

    it('should throw BadRequestException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.verifyPin('nonexistent', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if PIN is incorrect', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(false);

      await expect(service.verifyPin('user-123', '654321')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.verifyPin('user-123', '654321')).rejects.toThrow(
        'Incorrect PIN',
      );
    });
  });

  describe('requestPinResetOtp', () => {
    it('should send PIN reset OTP successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.token.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.token.create.mockResolvedValue({});
      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      const result = await service.requestPinResetOtp('user-123');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123', isDeleted: false },
      });
      expect(mockPrisma.token.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', type: 'pin_reset' },
      });
      expect(mockPrisma.token.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          token: expect.any(String),
          expiresAt: expect.any(Date),
          type: 'pin_reset',
        },
      });
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(
        'PinReset',
        {
          email: 'test@example.com',
          otp: expect.any(String),
          userName: 'Test User',
        },
      );
      expect(result).toEqual({ message: 'Pin reset token sent' });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.requestPinResetOtp('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ServiceUnavailableException if email sending fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.token.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.token.create.mockResolvedValue({});
      mockNotificationService.sendNotification.mockResolvedValue({
        success: false,
        error: 'SMTP connection failed',
      });

      await expect(service.requestPinResetOtp('user-123')).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.requestPinResetOtp('user-123')).rejects.toThrow(
        'SMTP connection failed',
      );
    });
  });

  describe('validatePinResetOtp', () => {
    const validToken = {
      id: 'token-123',
      userId: 'user-123',
      token: 'hashedOtp',
      type: 'pin_reset',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    };

    it('should validate OTP successfully', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(validToken);

      const result = await service.validatePinResetOtp('user-123', '123456');

      expect(mockPrisma.token.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          token: expect.any(String), // SHA256 hash of OTP
          type: 'pin_reset',
        },
      });
      expect(result).toEqual({ success: true, message: 'Valid OTP' });
    });

    it('should throw BadRequestException if OTP format is invalid', async () => {
      await expect(
        service.validatePinResetOtp('user-123', '12345'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validatePinResetOtp('user-123', '12345'),
      ).rejects.toThrow('OTP must be exactly 6 digits');
    });

    it('should throw BadRequestException if OTP is invalid', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(null);

      await expect(
        service.validatePinResetOtp('user-123', '654321'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validatePinResetOtp('user-123', '654321'),
      ).rejects.toThrow('Invalid OTP');
    });

    it('should throw BadRequestException if OTP is expired', async () => {
      const expiredToken = {
        ...validToken,
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      };
      mockPrisma.token.findFirst.mockResolvedValue(expiredToken);
      mockPrisma.token.delete.mockResolvedValue({});

      await expect(
        service.validatePinResetOtp('user-123', '123456'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validatePinResetOtp('user-123', '123456'),
      ).rejects.toThrow('OTP has expired');
      expect(mockPrisma.token.delete).toHaveBeenCalled();
    });
  });

  describe('resetPinWithOtp', () => {
    const validToken = {
      id: 'token-123',
      userId: 'user-123',
      token: 'hashedOtp',
      type: 'pin_reset',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    };

    it('should reset PIN successfully', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(validToken);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(false); // New PIN is different
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.token.delete.mockResolvedValue({});

      const result = await service.resetPinWithOtp('user-123', '123456', '654321');

      expect(pinUtil.hashPin).toHaveBeenCalledWith('654321');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { pinHash: 'newHashedPin' },
      });
      expect(mockPrisma.token.delete).toHaveBeenCalledWith({
        where: { id: 'token-123' },
      });
      expect(result).toEqual({
        success: true,
        message: 'PIN has been reset successfully',
      });
    });

    it('should throw BadRequestException if OTP format is invalid', async () => {
      await expect(
        service.resetPinWithOtp('user-123', '12345', '654321'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resetPinWithOtp('user-123', '12345', '654321'),
      ).rejects.toThrow('OTP must be exactly 6 digits');
    });

    it('should throw BadRequestException if PIN format is invalid', async () => {
      await expect(
        service.resetPinWithOtp('user-123', '123456', '12345'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resetPinWithOtp('user-123', '123456', '12345'),
      ).rejects.toThrow('PIN must be exactly 6 digits');
    });

    it('should throw BadRequestException if OTP is invalid', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPinWithOtp('user-123', '654321', '123456'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resetPinWithOtp('user-123', '654321', '123456'),
      ).rejects.toThrow('Invalid OTP');
    });

    it('should throw BadRequestException if OTP is expired', async () => {
      const expiredToken = {
        ...validToken,
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      };
      mockPrisma.token.findFirst.mockResolvedValue(expiredToken);
      mockPrisma.token.delete.mockResolvedValue({});

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow('OTP has expired');
    });

    it('should throw NotFoundException if user not found after OTP validation', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(validToken);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if new PIN is same as old PIN', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(validToken);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(true); // Same as old PIN

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow('New PIN cannot be the same as old PIN');
    });

    it('should allow PIN reset if user has no existing PIN', async () => {
      mockPrisma.token.findFirst.mockResolvedValue(validToken);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        pinHash: null,
      });
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.token.delete.mockResolvedValue({});

      const result = await service.resetPinWithOtp('user-123', '123456', '654321');

      expect(result).toEqual({
        success: true,
        message: 'PIN has been reset successfully',
      });
    });
  });
});
