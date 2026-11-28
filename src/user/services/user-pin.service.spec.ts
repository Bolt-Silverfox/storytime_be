import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  HttpStatus,
} from '@nestjs/common';
import { createHash } from 'crypto';
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
    issuePinResetToken: jest.Mock;
    redeemPinResetToken: jest.Mock;
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
      issuePinResetToken: jest.fn(),
      redeemPinResetToken: jest.fn(),
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
      mockUserRepository.issuePinResetToken.mockResolvedValue('issued');
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });

      const result = await service.requestPinResetOtp('user-123');

      expect(mockUserRepository.findUserById).toHaveBeenCalledWith('user-123');
      const [sentType, sent] = mockNotificationService.sendNotification.mock
        .calls[0] as [string, { email: string; otp: string; userName: string }];
      expect(sentType).toBe('PinReset');
      expect(sent).toEqual({
        email: 'test@example.com',
        otp: expect.stringMatching(/^\d{6}$/),
        userName: 'Test User',
      });
      expect(mockUserRepository.issuePinResetToken).toHaveBeenCalledWith({
        userId: 'user-123',
        hashedToken: createHash('sha256')
          .update(`user-123:${sent.otp}`)
          .digest('hex'),
        expiresAt: expect.any(Date),
        maxFailedAttempts: 5,
      });
      expect(result).toEqual({ message: 'Pin reset token sent' });
    });

    it('refuses to issue a code once the guess budget is spent', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      mockUserRepository.issuePinResetToken.mockResolvedValue(
        'guess_budget_spent',
      );

      await expect(
        service.requestPinResetOtp('user-123'),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
      expect(mockNotificationService.sendNotification).not.toHaveBeenCalled();
    });

    it('draws the code from crypto.randomInt, never Math.random', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      mockUserRepository.issuePinResetToken.mockResolvedValue('issued');
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });
      const randomSpy = jest.spyOn(Math, 'random');
      const randomIntSpy = jest
        .spyOn(
          jest.requireActual<typeof import('crypto')>('crypto'),
          'randomInt',
        )
        .mockImplementation(() => 42);

      try {
        await service.requestPinResetOtp('user-123');
      } finally {
        randomIntSpy.mockRestore();
        randomSpy.mockRestore();
      }

      expect(randomSpy).not.toHaveBeenCalled();
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(
        'PinReset',
        expect.objectContaining({ otp: '000042' }),
      );
    });

    it('expires the code one hour of elapsed time after issue across a DST change', async () => {
      const originalTz = process.env.TZ;
      process.env.TZ = 'America/New_York';
      const issuedAt = new Date('2026-11-01T05:30:00.000Z');
      jest.useFakeTimers({ now: issuedAt, doNotFake: ['nextTick'] });
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      mockUserRepository.issuePinResetToken.mockResolvedValue('issued');
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });

      try {
        await service.requestPinResetOtp('user-123');
      } finally {
        jest.useRealTimers();
        process.env.TZ = originalTz;
      }

      const [{ expiresAt }] = mockUserRepository.issuePinResetToken.mock
        .calls[0] as [{ expiresAt: Date }];
      expect(expiresAt.getTime() - issuedAt.getTime()).toBe(60 * 60 * 1000);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findUserById.mockResolvedValue(null);

      await expect(service.requestPinResetOtp('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('answers 503 without echoing the provider error when email sending fails', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      mockUserRepository.issuePinResetToken.mockResolvedValue('issued');
      mockNotificationService.sendNotification.mockResolvedValue({
        success: false,
        error: 'SMTP 550 mailbox test@example.com unavailable',
      });

      const failure = service.requestPinResetOtp('user-123');

      await expect(failure).rejects.toThrow(ServiceUnavailableException);
      await expect(failure).rejects.toThrow('Failed to send pin reset email');
    });
  });

  const otpHash = (otp: string) =>
    createHash('sha256').update(`user-123:${otp}`).digest('hex');

  describe('validatePinResetOtp', () => {
    it('should validate OTP successfully without consuming it', async () => {
      mockUserRepository.redeemPinResetToken.mockResolvedValue('valid');

      const result = await service.validatePinResetOtp('user-123', '123456');

      expect(mockUserRepository.redeemPinResetToken).toHaveBeenCalledWith({
        userId: 'user-123',
        hashedToken: otpHash('123456'),
        maxFailedAttempts: 5,
      });
      expect(result).toEqual({ success: true, message: 'Valid OTP' });
    });

    it('should throw BadRequestException if OTP format is invalid', async () => {
      await expect(
        service.validatePinResetOtp('user-123', '12345'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'OTP must be exactly 6 digits',
      });
      expect(mockUserRepository.redeemPinResetToken).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if OTP is invalid', async () => {
      mockUserRepository.redeemPinResetToken.mockResolvedValue('invalid');

      await expect(
        service.validatePinResetOtp('user-123', '654321'),
      ).rejects.toMatchObject({ status: 400, message: 'Invalid OTP' });
    });

    it('should throw BadRequestException if OTP is expired', async () => {
      mockUserRepository.redeemPinResetToken.mockResolvedValue('expired');

      await expect(
        service.validatePinResetOtp('user-123', '123456'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'OTP has expired. Please request a new one.',
      });
    });
  });

  describe('resetPinWithOtp', () => {
    it('should reset PIN successfully', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(false);
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockUserRepository.redeemPinResetToken.mockResolvedValue('pin_changed');

      const result = await service.resetPinWithOtp(
        'user-123',
        '123456',
        '654321',
      );

      expect(pinUtil.hashPin).toHaveBeenCalledWith('654321');
      expect(mockUserRepository.redeemPinResetToken).toHaveBeenCalledWith({
        userId: 'user-123',
        hashedToken: otpHash('123456'),
        maxFailedAttempts: 5,
        newPinHash: 'newHashedPin',
      });
      expect(result).toEqual({
        success: true,
        message: 'PIN has been reset successfully',
      });
    });

    it('should throw BadRequestException if OTP format is invalid', async () => {
      await expect(
        service.resetPinWithOtp('user-123', '12345', '654321'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'OTP must be exactly 6 digits',
      });
    });

    it('should throw BadRequestException if PIN format is invalid', async () => {
      await expect(
        service.resetPinWithOtp('user-123', '123456', '12345'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'PIN must be exactly 6 digits',
      });
    });

    it('should throw BadRequestException if OTP is invalid', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(false);
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockUserRepository.redeemPinResetToken.mockResolvedValue('invalid');

      await expect(
        service.resetPinWithOtp('user-123', '654321', '123456'),
      ).rejects.toMatchObject({ status: 400, message: 'Invalid OTP' });
    });

    it('should throw BadRequestException if OTP is expired', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(false);
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockUserRepository.redeemPinResetToken.mockResolvedValue('expired');

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'OTP has expired. Please request a new one.',
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findUserById.mockResolvedValue(null);

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toThrow(NotFoundException);
      expect(mockUserRepository.redeemPinResetToken).not.toHaveBeenCalled();
    });

    it('rejects a PIN equal to the old one only after the OTP is accepted, without consuming it', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(true);
      mockUserRepository.redeemPinResetToken.mockResolvedValue('valid');

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'New PIN cannot be the same as old PIN',
      });
      expect(mockUserRepository.redeemPinResetToken).toHaveBeenCalledWith({
        userId: 'user-123',
        hashedToken: otpHash('123456'),
        maxFailedAttempts: 5,
      });
    });

    it('does not reveal that the PIN matches the old one when the OTP is wrong', async () => {
      mockUserRepository.findUserById.mockResolvedValue(mockUser);
      (pinUtil.verifyPinHash as jest.Mock).mockResolvedValue(true);
      mockUserRepository.redeemPinResetToken.mockResolvedValue('invalid');

      await expect(
        service.resetPinWithOtp('user-123', '123456', '654321'),
      ).rejects.toMatchObject({ status: 400, message: 'Invalid OTP' });
    });

    it('should allow PIN reset if user has no existing PIN', async () => {
      mockUserRepository.findUserById.mockResolvedValue({
        ...mockUser,
        pinHash: null,
      });
      (pinUtil.hashPin as jest.Mock).mockResolvedValue('newHashedPin');
      mockUserRepository.redeemPinResetToken.mockResolvedValue('pin_changed');

      const result = await service.resetPinWithOtp(
        'user-123',
        '123456',
        '654321',
      );

      expect(pinUtil.verifyPinHash).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'PIN has been reset successfully',
      });
    });
  });
});
