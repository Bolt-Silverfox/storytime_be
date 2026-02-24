import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import {
  AUTH_REPOSITORY,
  IAuthRepository,
  IAuthRepositoryTransaction,
} from '../repositories';
import { TokenType } from '../dto/auth.dto';
import { AppEvents } from '@/shared/events';
import { Role, OnboardingStatus } from '@prisma/client';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import * as bcrypt from 'bcryptjs';

jest.mock('@/shared/utils/generate-token', () => ({
  generateToken: jest.fn().mockReturnValue({
    token: 'raw-reset-token',
    expiresAt: new Date('2026-03-01T00:00:00Z'),
  }),
}));

describe('PasswordService', () => {
  let service: PasswordService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: '$2a$10$hashedpasswordvalue',
    isEmailVerified: true,
    role: Role.parent,
    onboardingStatus: OnboardingStatus.profile_setup,
    googleId: null,
    appleId: null,
    avatarId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockResetToken = {
    id: 'token-1',
    userId: 'user-1',
    token: 'hashed-reset-token',
    type: TokenType.PASSWORD_RESET,
    expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
    createdAt: new Date(),
    user: mockUser,
  };

  beforeEach(async () => {
    // Default bcrypt mocks (can be overridden per-test)
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const mockAuthRepository: Partial<jest.Mocked<IAuthRepository>> = {
      findUserByEmail: jest.fn(),
      findUserById: jest.fn(),
      deleteUserTokensByType: jest.fn(),
      createToken: jest.fn(),
      findTokenByHashedToken: jest.fn(),
      deleteToken: jest.fn(),
      updateUser: jest.fn(),
      deleteAllUserSessions: jest.fn(),
      transaction: jest.fn(),
    };

    const mockTokenService: Partial<jest.Mocked<TokenService>> = {
      hashToken: jest.fn().mockReturnValue('hashed-reset-token'),
    };

    const mockEventEmitter: Partial<jest.Mocked<EventEmitter2>> = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: TokenService, useValue: mockTokenService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
    authRepository = module.get(AUTH_REPOSITORY);
    tokenService = module.get(TokenService);
    eventEmitter = module.get(EventEmitter2);
  });

  describe('requestPasswordReset', () => {
    it('should create reset token and emit event for existing user', async () => {
      // Arrange
      authRepository.findUserByEmail.mockResolvedValue(mockUser as any);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue({} as any);

      // Act
      const result = await service.requestPasswordReset({
        email: 'test@example.com',
      });

      // Assert
      expect(result).toEqual({ message: 'Password reset token sent' });
      expect(authRepository.findUserByEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(authRepository.deleteUserTokensByType).toHaveBeenCalledWith(
        'user-1',
        TokenType.PASSWORD_RESET,
      );
      expect(authRepository.createToken).toHaveBeenCalledWith({
        userId: 'user-1',
        token: 'hashed-reset-token',
        expiresAt: expect.any(Date),
        type: TokenType.PASSWORD_RESET,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'password.reset_requested',
        {
          userId: 'user-1',
          email: 'test@example.com',
          resetToken: 'raw-reset-token',
        },
      );
    });

    it('should throw NotFoundException when user is not found', async () => {
      // Arrange
      authRepository.findUserByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.requestPasswordReset({ email: 'nonexistent@example.com' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should delete existing reset tokens before creating new one', async () => {
      // Arrange
      const callOrder: string[] = [];
      authRepository.findUserByEmail.mockResolvedValue(mockUser as any);
      authRepository.deleteUserTokensByType.mockImplementation(() => {
        callOrder.push('deleteTokens');
        return Promise.resolve();
      });
      authRepository.createToken.mockImplementation(() => {
        callOrder.push('createToken');
        return Promise.resolve({} as any);
      });

      // Act
      await service.requestPasswordReset({ email: 'test@example.com' });

      // Assert
      expect(callOrder).toEqual(['deleteTokens', 'createToken']);
    });
  });

  describe('validateResetToken', () => {
    it('should return success for a valid token', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(
        mockResetToken as any,
      );

      // Act
      const result = await service.validateResetToken(
        'raw-reset-token',
        'test@example.com',
        { token: 'raw-reset-token', email: 'test@example.com' },
      );

      // Assert
      expect(result).toEqual({ message: 'Valid reset token' });
      expect(tokenService.hashToken).toHaveBeenCalledWith('raw-reset-token');
      expect(authRepository.findTokenByHashedToken).toHaveBeenCalledWith(
        'hashed-reset-token',
        TokenType.PASSWORD_RESET,
      );
    });

    it('should throw NotFoundException when token is not found', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.validateResetToken('invalid-token', 'test@example.com', {
          token: 'invalid-token',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException when token has expired', async () => {
      // Arrange
      const expiredToken = {
        ...mockResetToken,
        expiresAt: new Date('2020-01-01'),
      };
      authRepository.findTokenByHashedToken.mockResolvedValue(
        expiredToken as any,
      );
      authRepository.deleteToken.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        service.validateResetToken('expired-token', 'test@example.com', {
          token: 'expired-token',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });

    it('should throw UnauthorizedException when email does not match token user', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(
        mockResetToken as any,
      );

      // Act & Assert
      await expect(
        service.validateResetToken('raw-reset-token', 'wrong@example.com', {
          token: 'raw-reset-token',
          email: 'wrong@example.com',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully with valid token', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(
        mockResetToken as any,
      );
      authRepository.updateUser.mockResolvedValue({} as any);
      authRepository.deleteToken.mockResolvedValue(undefined);
      authRepository.deleteAllUserSessions.mockResolvedValue(undefined);

      // Act
      const result = await service.resetPassword(
        'raw-reset-token',
        'test@example.com',
        'NewPassword1#',
        {
          token: 'raw-reset-token',
          email: 'test@example.com',
          newPassword: 'NewPassword1#',
        },
      );

      // Assert
      expect(result).toEqual({
        message: 'Password has been reset successfully',
      });
      expect(authRepository.updateUser).toHaveBeenCalledWith('user-1', {
        passwordHash: expect.any(String),
      });
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
      expect(authRepository.deleteAllUserSessions).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('should throw NotFoundException when token is not found', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.resetPassword(
          'invalid-token',
          'test@example.com',
          'NewPass1#',
          {
            token: 'invalid-token',
            email: 'test@example.com',
            newPassword: 'NewPass1#',
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException when token has expired', async () => {
      // Arrange
      const expiredToken = {
        ...mockResetToken,
        expiresAt: new Date('2020-01-01'),
      };
      authRepository.findTokenByHashedToken.mockResolvedValue(
        expiredToken as any,
      );
      authRepository.deleteToken.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        service.resetPassword(
          'expired-token',
          'test@example.com',
          'NewPass1#',
          {
            token: 'expired-token',
            email: 'test@example.com',
            newPassword: 'NewPass1#',
          },
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });

    it('should invalidate all user sessions after password reset', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(
        mockResetToken as any,
      );
      authRepository.updateUser.mockResolvedValue({} as any);
      authRepository.deleteToken.mockResolvedValue(undefined);
      authRepository.deleteAllUserSessions.mockResolvedValue(undefined);

      // Act
      await service.resetPassword(
        'raw-reset-token',
        'test@example.com',
        'NewPassword1#',
        {
          token: 'raw-reset-token',
          email: 'test@example.com',
          newPassword: 'NewPassword1#',
        },
      );

      // Assert
      expect(authRepository.deleteAllUserSessions).toHaveBeenCalledWith(
        'user-1',
      );
    });
  });

  describe('changePassword', () => {
    beforeEach(() => {
      (bcrypt.compare as jest.Mock).mockImplementation((plain: string) => {
        if (plain === 'OldPassword1#') return Promise.resolve(true);
        return Promise.resolve(false);
      });
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');
    });

    it('should change password successfully', async () => {
      // Arrange
      authRepository.findUserById.mockResolvedValue(mockUser as any);
      authRepository.transaction.mockImplementation(async (fn) => {
        const tx: jest.Mocked<IAuthRepositoryTransaction> = {
          updateUser: jest.fn().mockResolvedValue({} as any),
          deleteOtherSessions: jest.fn().mockResolvedValue(undefined),
        };
        return fn(tx);
      });

      // Act
      const result = await service.changePassword(
        'user-1',
        { oldPassword: 'OldPassword1#', newPassword: 'NewPassword1#' },
        'current-session-1',
      );

      // Assert
      expect(result).toEqual({ message: 'Password changed successfully' });
      expect(authRepository.findUserById).toHaveBeenCalledWith('user-1');
    });

    it('should emit password.changed and USER_PASSWORD_CHANGED events', async () => {
      // Arrange
      authRepository.findUserById.mockResolvedValue(mockUser as any);
      authRepository.transaction.mockImplementation(async (fn) => {
        const tx: jest.Mocked<IAuthRepositoryTransaction> = {
          updateUser: jest.fn().mockResolvedValue({} as any),
          deleteOtherSessions: jest.fn().mockResolvedValue(undefined),
        };
        return fn(tx);
      });

      // Act
      await service.changePassword(
        'user-1',
        { oldPassword: 'OldPassword1#', newPassword: 'NewPassword1#' },
        'current-session-1',
      );

      // Assert
      expect(eventEmitter.emit).toHaveBeenCalledWith('password.changed', {
        userId: 'user-1',
        email: 'test@example.com',
        userName: 'Test User',
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AppEvents.USER_PASSWORD_CHANGED,
        expect.objectContaining({
          userId: 'user-1',
          changedAt: expect.any(Date),
          sessionsInvalidated: true,
        }),
      );
    });

    it('should throw NotFoundException when user is not found', async () => {
      // Arrange
      authRepository.findUserById.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.changePassword(
          'nonexistent-user',
          { oldPassword: 'OldPassword1#', newPassword: 'NewPassword1#' },
          'session-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when old password is incorrect', async () => {
      // Arrange
      authRepository.findUserById.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // Act & Assert
      await expect(
        service.changePassword(
          'user-1',
          { oldPassword: 'WrongPassword1#', newPassword: 'NewPassword1#' },
          'session-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when new password is same as old', async () => {
      // Arrange
      authRepository.findUserById.mockResolvedValue(mockUser as any);
      // First call: oldPassword matches -> true
      // Second call: newPassword matches old hash -> true (same password)
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      // Act & Assert
      await expect(
        service.changePassword(
          'user-1',
          { oldPassword: 'SamePassword1#', newPassword: 'SamePassword1#' },
          'session-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use transaction to update password and delete other sessions', async () => {
      // Arrange
      authRepository.findUserById.mockResolvedValue(mockUser as any);
      const mockTxUpdateUser = jest.fn().mockResolvedValue({} as any);
      const mockTxDeleteOtherSessions = jest.fn().mockResolvedValue(undefined);
      authRepository.transaction.mockImplementation(async (fn) => {
        const tx: jest.Mocked<IAuthRepositoryTransaction> = {
          updateUser: mockTxUpdateUser,
          deleteOtherSessions: mockTxDeleteOtherSessions,
        };
        return fn(tx);
      });

      // Act
      await service.changePassword(
        'user-1',
        { oldPassword: 'OldPassword1#', newPassword: 'NewPassword1#' },
        'current-session-1',
      );

      // Assert
      expect(authRepository.transaction).toHaveBeenCalled();
      expect(mockTxUpdateUser).toHaveBeenCalledWith('user-1', {
        passwordHash: 'new-hashed-password',
      });
      expect(mockTxDeleteOtherSessions).toHaveBeenCalledWith(
        'user-1',
        'current-session-1',
      );
    });
  });

  describe('verifyPassword', () => {
    it('should return true for matching password', async () => {
      // Arrange
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // Act
      const result = await service.verifyPassword(
        'correctPassword',
        'hashedPassword',
      );

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      // Arrange
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // Act
      const result = await service.verifyPassword(
        'wrongPassword',
        'hashedPassword',
      );

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('hashPassword', () => {
    it('should return a hashed password', async () => {
      // Arrange
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-value');

      // Act
      const result = await service.hashPassword('plainPassword');

      // Assert
      expect(result).toBe('hashed-value');
      expect(bcrypt.hash).toHaveBeenCalledWith('plainPassword', 12);
    });

    it('should use salt rounds of 12', async () => {
      // Arrange
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

      // Act
      await service.hashPassword('password');

      // Assert
      expect(bcrypt.hash).toHaveBeenCalledWith('password', 12);
    });
  });
});
