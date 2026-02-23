import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserPinService } from './user-pin.service';
import { USER_REPOSITORY } from '../repositories';
import { NotificationService } from '@/notification/notification.service';
import * as pinUtil from '../utils/pin.util';

// Mock pin utilities
jest.mock('../utils/pin.util', () => ({
  hashPin: jest.fn(),
  verifyPinHash: jest.fn(),
}));

describe('UserPinService', () => {
  let service: UserPinService;
  let mockUserRepository: {
    findUserById: jest.Mock;
    updateUserSimple: jest.Mock;
    deleteTokensByUserAndType: jest.Mock;
    createToken: jest.Mock;
    findTokenByHashedToken: jest.Mock;
    deleteToken: jest.Mock;
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
    mockUserRepository = {
      findUserById: jest.fn(),
      updateUserSimple: jest.fn(),
      deleteTokensByUserAndType: jest.fn(),
      createToken: jest.fn(),
      findTokenByHashedToken: jest.fn(),
      deleteToken: jest.fn(),
    };

    mockNotificationService = {
      sendNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPinService,
        {
          provide: USER_REPOSITORY,
          useValue: mockUserRepository,
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
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockUserRepository.updateUserSimple.mockResolvedValue({
        ...mockUser,
        pinHash: 'newHashedPin',
        onboardingStatus: 'pin_setup',
      });

      const result = await service.setPin('user-123', '123456');

      expect(mockUserRepository.findUserById).toHaveBeenCalledWith('user-123');
      expect(pinUtil.hashPin).toHaveBeenCalledWith('123456');
      expect(mockUserRepository.updateUserSimple).toHaveBeenCalledWith(
        'user-123',
        { pinHash: 'newHashedPin', onboardingStatus: 'pin_setup' },
      );
      expect(result).toEqual({
        success: true,
        message: 'PIN set successfully',
      });
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
      mockUserRepository.findUserById.mockResolvedValue(null);

      await expect(service.setPin('nonexistent', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if onboarding not at profile_setup stage', async () => {
      mockUserRepository.findUserById.mockResolvedValue({
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
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyPin('user-123', '123456');

      expect(mockUserRepository.findUserById).toHaveBeenCalledWith('user-123');
      expect(pinUtil.verifyPinHash).toHaveBeenCalledWith(
        '123456',
        'hashedPin123',
      );
      expect(result).toEqual({
        success: true,
        message: 'PIN verified successfully',
      });
    });

    it('should throw BadRequestException if no PIN is set', async () => {
      mockUserRepository.findUserById.mockResolvedValue({
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
      mockUserRepository.findUserById.mockResolvedValue(null);

      await expect(service.verifyPin('nonexistent', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if PIN is incorrect', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
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
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      mockUserRepository.deleteTokensByUserAndType.mockResolvedValue(undefined);
      mockUserRepository.createToken.mockResolvedValue({});
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });

      const result = await service.requestPinResetOtp('user-123');

      expect(mockUserRepository.findUserById).toHaveBeenCalledWith('user-123');
      expect(mockUserRepository.deleteTokensByUserAndType).toHaveBeenCalledWith(
        'user-123',
        'pin_reset',
      );
      expect(mockUserRepository.createToken).toHaveBeenCalledWith({
        userId: 'user-123',
        token: expect.any(String),
        expiresAt: expect.any(Date),
        type: 'pin_reset',
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
      mockUserRepository.findUserById.mockResolvedValue(null);

      await expect(service.requestPinResetOtp('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ServiceUnavailableException if email sending fails', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      mockUserRepository.deleteTokensByUserAndType.mockResolvedValue(undefined);
      mockUserRepository.createToken.mockResolvedValue({});
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
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(validToken);

      const result = await service.validatePinResetOtp('user-123', '123456');

      expect(mockUserRepository.findTokenByHashedToken).toHaveBeenCalledWith(
        'user-123',
        expect.any(String), // SHA256 hash of OTP
        'pin_reset',
      );
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
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(null);

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
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(expiredToken);
      mockUserRepository.deleteToken.mockResolvedValue(undefined);

      await expect(
        service.validatePinResetOtp('user-123', '123456'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validatePinResetOtp('user-123', '123456'),
      ).rejects.toThrow('OTP has expired');
      expect(mockUserRepository.deleteToken).toHaveBeenCalled();
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
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(validToken);
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(false); // New PIN is different
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockUserRepository.updateUserSimple.mockResolvedValue({});
      mockUserRepository.deleteToken.mockResolvedValue(undefined);

      const result = await service.resetPinWithOtp(
        'user-123',
        '123456',
        '654321',
      );

      expect(pinUtil.hashPin).toHaveBeenCalledWith('654321');
      expect(mockUserRepository.updateUserSimple).toHaveBeenCalledWith(
        'user-123',
        { pinHash: 'newHashedPin' },
      );
      expect(mockUserRepository.deleteToken).toHaveBeenCalledWith('token-123');
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
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(null);

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
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(expiredToken);
      mockUserRepository.deleteToken.mockResolvedValue(undefined);

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow('OTP has expired');
    });

    it('should throw NotFoundException if user not found after OTP validation', async () => {
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(validToken);
      mockUserRepository.findUserById.mockResolvedValue(null);

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if new PIN is same as old PIN', async () => {
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(validToken);
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(true); // Same as old PIN

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow('New PIN cannot be the same as old PIN');
    });

    it('should allow PIN reset if user has no existing PIN', async () => {
      mockUserRepository.findTokenByHashedToken.mockResolvedValue(validToken);
      mockUserRepository.findUserById.mockResolvedValue({
        ...mockUser,
        pinHash: null,
      });
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockUserRepository.updateUserSimple.mockResolvedValue({});
      mockUserRepository.deleteToken.mockResolvedValue(undefined);

      const result = await service.resetPinWithOtp(
        'user-123',
        '123456',
        '654321',
      );

      expect(result).toEqual({
        success: true,
        message: 'PIN has been reset successfully',
      });
    });
  });
});
