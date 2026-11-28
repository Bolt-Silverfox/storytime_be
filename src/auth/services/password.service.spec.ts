import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import {
  AUTH_REPOSITORY,
  IAuthRepository,
  IAuthRepositoryTransaction,
  TokenWithUser,
} from '../repositories';
import {
  makeToken,
  makeUser,
  makeUserIP,
} from '@/shared/testing/prisma-fixtures';
import { TokenType } from '../dto/auth.dto';
import { AppEvents } from '@/shared/events';
import { Role, OnboardingStatus } from '@prisma/client';
import { HttpException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '@/redis/redis.service';
import { FakeRedisClient, FakeReply } from '@/shared/testing/fake-redis';

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
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  let service: PasswordService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let redis: FakeRedisClient;
  let resetTx: jest.Mocked<IAuthRepositoryTransaction>;

  const mockUser = makeUser({
    passwordHash: '$2a$10$hashedpasswordvalue',
    role: Role.parent,
    onboardingStatus: OnboardingStatus.profile_setup,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  const mockResetToken: TokenWithUser = {
    ...makeToken({
      token: 'hashed-reset-token',
      type: TokenType.PASSWORD_RESET,
      expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
      createdAt: new Date(),
    }),
    user: mockUser,
  };

  beforeEach(async () => {
    // Default bcrypt mocks (can be overridden per-test)
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const mockAuthRepository: Partial<jest.Mocked<IAuthRepository>> = {
      findUserByEmail: jest.fn(),
      findUserByEmailIgnoringCase: jest.fn(),
      findUserById: jest.fn(),
      deleteUserTokensByType: jest.fn(),
      createToken: jest.fn(),
      findTokenByHashedToken: jest.fn(),
      deleteToken: jest.fn(),
      updateUser: jest.fn(),
      deleteAllUserSessions: jest.fn(),
      transaction: jest.fn(),
      findKnownUserIP: jest.fn(),
      recordUserIP: jest.fn(),
      touchUserIP: jest.fn(),
    };
    resetTx = {
      consumeToken: jest.fn().mockResolvedValue(true),
      updateUser: jest.fn((id: string, data: { passwordHash: string }) =>
        mockAuthRepository.updateUser!(id, data),
      ),
      deleteAllUserSessions: jest.fn((userId: string) =>
        mockAuthRepository.deleteAllUserSessions!(userId),
      ),
      markEmailVerified: jest.fn(),
      deleteOtherSessions: jest.fn(),
      findActiveUserLinkedProviderFields: jest.fn(),
      unlinkProviderField: jest.fn(),
    };
    mockAuthRepository.transaction!.mockImplementation((fn) => fn(resetTx));

    const mockTokenService: Partial<jest.Mocked<TokenService>> = {
      hashToken: jest.fn().mockReturnValue('hashed-reset-token'),
    };

    const mockEventEmitter: Partial<jest.Mocked<EventEmitter2>> = {
      emit: jest.fn(),
    };

    redis = new FakeRedisClient();
    const mockRedis = { client: redis };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordService,
        { provide: RedisService, useValue: mockRedis },
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
    it('issues a code to an account stored with a mixed-case form of the email', async () => {
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue({
        ...mockUser,
        email: 'Test@Example.com',
      });
      authRepository.createToken.mockResolvedValue(makeToken());

      await expect(
        service.requestPasswordReset({ email: 'test@example.com' }),
      ).resolves.toEqual({ message: 'Password reset token sent' });
      expect(authRepository.createToken).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
      );
    });

    it('should create reset token and emit event for existing user', async () => {
      // Arrange
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue(makeToken());

      // Act
      const result = await service.requestPasswordReset({
        email: 'test@example.com',
      });

      // Assert
      expect(result).toEqual({ message: 'Password reset token sent' });
      expect(authRepository.findUserByEmailIgnoringCase).toHaveBeenCalledWith(
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
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.requestPasswordReset({ email: 'nonexistent@example.com' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should alert but NOT record IP when reset requested from an unfamiliar IP', async () => {
      // Arrange
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      authRepository.findKnownUserIP.mockResolvedValue(null);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue(makeToken());

      // Act
      await service.requestPasswordReset(
        { email: 'test@example.com' },
        '203.0.113.5',
        'Mozilla/5.0',
      );

      // Assert
      expect(authRepository.findKnownUserIP).toHaveBeenCalledWith(
        'user-1',
        '203.0.113.5',
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('password.reset_alert', {
        userId: 'user-1',
        email: 'test@example.com',
        ipAddress: '203.0.113.5',
        userAgent: 'Mozilla/5.0',
        timestamp: expect.any(String),
        userName: 'Test User',
      });
      // An unauthenticated request must NOT establish a trusted IP.
      expect(authRepository.recordUserIP).not.toHaveBeenCalled();
      expect(authRepository.touchUserIP).not.toHaveBeenCalled();
    });

    it('should touch a known IP and not alert on a familiar IP', async () => {
      // Arrange
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      authRepository.findKnownUserIP.mockResolvedValue(
        makeUserIP({ ipAddress: '203.0.113.5' }),
      );
      authRepository.touchUserIP.mockResolvedValue(undefined);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue(makeToken());

      // Act
      await service.requestPasswordReset(
        { email: 'test@example.com' },
        '203.0.113.5',
        'Mozilla/5.0',
      );

      // Assert
      expect(authRepository.touchUserIP).toHaveBeenCalledWith('ip-1');
      expect(authRepository.recordUserIP).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'password.reset_alert',
        expect.anything(),
      );
    });

    it('should still reset when the IP check throws', async () => {
      // Arrange
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      authRepository.findKnownUserIP.mockRejectedValue(new Error('db down'));
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue(makeToken());

      // Act
      const result = await service.requestPasswordReset(
        { email: 'test@example.com' },
        '203.0.113.5',
        'Mozilla/5.0',
      );

      // Assert — reset proceeds despite the alert path failing
      expect(result).toEqual({ message: 'Password reset token sent' });
      expect(authRepository.createToken).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'password.reset_requested',
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('should skip the IP check entirely when no IP is provided', async () => {
      // Arrange
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue(makeToken());

      // Act
      await service.requestPasswordReset({ email: 'test@example.com' });

      // Assert
      expect(authRepository.findKnownUserIP).not.toHaveBeenCalled();
      expect(authRepository.recordUserIP).not.toHaveBeenCalled();
      expect(authRepository.touchUserIP).not.toHaveBeenCalled();
    });

    it('should delete existing reset tokens before creating new one', async () => {
      // Arrange
      const callOrder: string[] = [];
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      authRepository.deleteUserTokensByType.mockImplementation(() => {
        callOrder.push('deleteTokens');
        return Promise.resolve();
      });
      authRepository.createToken.mockImplementation(() => {
        callOrder.push('createToken');
        return Promise.resolve(makeToken());
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
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

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
      authRepository.findTokenByHashedToken.mockResolvedValue(expiredToken);
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

    it('should throw NotFoundException when email does not match token user', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      // Act & Assert
      await expect(
        service.validateResetToken('raw-reset-token', 'wrong@example.com', {
          token: 'raw-reset-token',
          email: 'wrong@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
    });
    it('rejects a live token with a wrong email exactly like an unknown token', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      await expect(
        service.validateResetToken('raw-reset-token', 'throwaway@example.com', {
          token: 'raw-reset-token',
          email: 'throwaway@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('charges rotating-email guesses to the token owner and locks them out at the cap', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      for (let i = 0; i < 5; i++) {
        await expect(
          service.validateResetToken('raw-reset-token', `t${i}@example.com`, {
            token: 'raw-reset-token',
            email: `t${i}@example.com`,
          }),
        ).rejects.toThrow(NotFoundException);
      }

      await expect(
        service.validateResetToken('raw-reset-token', 'test@example.com', {
          token: 'raw-reset-token',
          email: 'test@example.com',
        }),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('does not clear the counter when validation fails', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(
        service.validateResetToken('x', 'test@example.com', {
          token: 'x',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(redis.values.size).toBe(1);
    });

    it('clears the counter after a successful validation', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(
        service.validateResetToken('x', 'test@example.com', {
          token: 'x',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      await service.validateResetToken('raw-reset-token', 'test@example.com', {
        token: 'raw-reset-token',
        email: 'test@example.com',
      });

      expect(redis.values.size).toBe(0);
    });

    it.each([
      { label: '401', prior: 0, status: 401 },
      { label: '429 for a miss counted past the cap', prior: 5, status: 429 },
    ])(
      'keeps the $label answer for an expired code when deleting it fails, and logs the failure by class only',
      async ({ prior, status }) => {
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        authRepository.findTokenByHashedToken.mockResolvedValue({
          ...mockResetToken,
          expiresAt: new Date('2020-01-01'),
        });
        authRepository.deleteToken.mockRejectedValue(
          new Error(`db down for ${mockUser.email}`),
        );
        redis.seed(
          `password-reset:misses:${createHash('sha256').update(mockUser.email).digest('hex')}`,
          prior,
        );
        const evalOnce = redis.eval;
        jest
          .spyOn(redis, 'eval')
          .mockImplementationOnce(() => Promise.resolve(null))
          .mockImplementation(evalOnce);

        await expect(
          service.validateResetToken('raw-reset-token', mockUser.email, {
            token: 'raw-reset-token',
            email: mockUser.email,
          }),
        ).rejects.toMatchObject({ status });

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to delete expired reset code (Error)',
        );
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
          mockUser.email,
        );
        errorSpy.mockRestore();
      },
    );

    it('treats an expired token with a wrong email as unknown and keeps the token', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue({
        ...mockResetToken,
        expiresAt: new Date('2020-01-01'),
      });

      await expect(
        service.validateResetToken('raw-reset-token', 'other@example.com', {
          token: 'raw-reset-token',
          email: 'other@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(authRepository.deleteToken).not.toHaveBeenCalled();
    });

    it('shares one counter across email casing and whitespace', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      for (const e of ['a@example.com', 'A@Example.com', ' a@example.com ']) {
        await expect(
          service.validateResetToken('x', e, { token: 'x', email: e }),
        ).rejects.toThrow(NotFoundException);
      }
      expect(redis.counts()).toEqual([3]);
    });

    it('charges a failed guess once when the owner email differs only in casing', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue({
        ...mockResetToken,
        expiresAt: new Date('2020-01-01'),
        user: { ...mockUser, email: 'Test@Example.com' },
      });

      await expect(
        service.validateResetToken('raw-reset-token', 'test@example.com', {
          token: 'raw-reset-token',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(redis.counts()).toEqual([1]);
    });

    it('sets a TTL on the counter in the same atomic operation as the first failure', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(
        service.validateResetToken('x', 'test@example.com', {
          token: 'x',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
      expect([...redis.ttls.values()]).toEqual([3_600_000]);
    });

    it('does not tell the caller a fresh code unlocks them', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      for (let i = 0; i < 5; i++) {
        await expect(
          service.validateResetToken('x', 'test@example.com', {
            token: 'x',
            email: 'test@example.com',
          }),
        ).rejects.toThrow(NotFoundException);
      }
      await expect(
        service.validateResetToken('x', 'test@example.com', {
          token: 'x',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(/try again later/i);
    });

    it('locks out after 5 failed guesses, even for the correct token', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      for (let i = 0; i < 5; i++) {
        await expect(
          service.validateResetToken(`guess-${i}`, 'test@example.com', {
            token: `guess-${i}`,
            email: 'test@example.com',
          }),
        ).rejects.toThrow(NotFoundException);
      }
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      await expect(
        service.validateResetToken('raw-reset-token', 'test@example.com', {
          token: 'raw-reset-token',
          email: 'test@example.com',
        }),
      ).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully with valid token', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      authRepository.updateUser.mockResolvedValue(makeUser());
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
      expect(resetTx.consumeToken).toHaveBeenCalledWith('token-1');
      expect(authRepository.deleteAllUserSessions).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('should record the requesting IP as known on successful completion', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      authRepository.updateUser.mockResolvedValue(makeUser());
      authRepository.deleteToken.mockResolvedValue(undefined);
      authRepository.deleteAllUserSessions.mockResolvedValue(undefined);
      authRepository.findKnownUserIP.mockResolvedValue(null);
      authRepository.recordUserIP.mockResolvedValue(undefined);

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
        '203.0.113.5',
        'Mozilla/5.0',
      );

      // Assert — the IP becomes known only after the token-authenticated reset
      expect(authRepository.recordUserIP).toHaveBeenCalledWith(
        'user-1',
        '203.0.113.5',
        'Mozilla/5.0',
      );
    });

    it('should touch an already-known IP on completion without duplicating it', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      authRepository.updateUser.mockResolvedValue(makeUser());
      authRepository.deleteToken.mockResolvedValue(undefined);
      authRepository.deleteAllUserSessions.mockResolvedValue(undefined);
      authRepository.findKnownUserIP.mockResolvedValue(makeUserIP());
      authRepository.touchUserIP.mockResolvedValue(undefined);

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
        '203.0.113.5',
        'Mozilla/5.0',
      );

      // Assert
      expect(authRepository.touchUserIP).toHaveBeenCalledWith('ip-1');
      expect(authRepository.recordUserIP).not.toHaveBeenCalled();
    });

    it('should still complete the reset when IP recording fails', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      authRepository.updateUser.mockResolvedValue(makeUser());
      authRepository.deleteToken.mockResolvedValue(undefined);
      authRepository.deleteAllUserSessions.mockResolvedValue(undefined);
      // Unfamiliar IP, then the persistence itself fails — exercises the
      // recordUserIP best-effort path (not just the lookup).
      authRepository.findKnownUserIP.mockResolvedValue(null);
      authRepository.recordUserIP.mockRejectedValue(new Error('db down'));

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
        '203.0.113.5',
        'Mozilla/5.0',
      );

      // Assert — recording is best-effort and must not fail the reset
      expect(result).toEqual({
        message: 'Password has been reset successfully',
      });
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
      authRepository.findTokenByHashedToken.mockResolvedValue(expiredToken);
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
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      authRepository.updateUser.mockResolvedValue(makeUser());
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

    it('treats an expired token with a wrong email as unknown and keeps the token', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue({
        ...mockResetToken,
        expiresAt: new Date('2020-01-01'),
      });

      await expect(
        service.resetPassword(
          'raw-reset-token',
          'other@example.com',
          'N1#aaaaa',
          {
            token: 'raw-reset-token',
            email: 'other@example.com',
            newPassword: 'N1#aaaaa',
          },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(authRepository.deleteToken).not.toHaveBeenCalled();
    });

    it('leaves the password and sessions untouched when the code is consumed concurrently', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      resetTx.consumeToken.mockResolvedValue(false);

      await expect(
        service.resetPassword('raw-reset-token', 'test@example.com', 'x', {
          token: 'raw-reset-token',
          email: 'test@example.com',
          newPassword: 'x',
        }),
      ).rejects.toThrow(new NotFoundException('Invalid reset token'));
      expect(authRepository.updateUser).not.toHaveBeenCalled();
      expect(authRepository.deleteAllUserSessions).not.toHaveBeenCalled();
    });

    describe('email binding', () => {
      it('rejects a valid token presented with a different email and leaves the account untouched', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

        await expect(
          service.resetPassword(
            'raw-reset-token',
            'attacker@example.com',
            'NewPass1#',
            {
              token: 'raw-reset-token',
              email: 'attacker@example.com',
              newPassword: 'NewPass1#',
            },
          ),
        ).rejects.toThrow(NotFoundException);

        expect(authRepository.updateUser).not.toHaveBeenCalled();
        expect(authRepository.deleteAllUserSessions).not.toHaveBeenCalled();
        expect(authRepository.deleteToken).not.toHaveBeenCalled();
      });

      it('accepts the owner email regardless of the stored casing', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue({
          ...mockResetToken,
          user: { ...mockUser, email: 'Test@Example.com' },
        });

        await expect(
          service.resetPassword(
            'raw-reset-token',
            'test@example.com',
            'NewPass1#',
            {
              token: 'raw-reset-token',
              email: 'test@example.com',
              newPassword: 'NewPass1#',
            },
          ),
        ).resolves.toEqual({ message: 'Password has been reset successfully' });
        expect(authRepository.updateUser).toHaveBeenCalledWith(
          mockResetToken.userId,
          { passwordHash: 'hashed-password' },
        );
      });
    });

    describe('attempt cap', () => {
      const attempt = (token: string, email = 'test@example.com') =>
        service.resetPassword(token, email, 'NewPass1#', {
          token,
          email,
          newPassword: 'NewPass1#',
        });

      it('locks out after 5 failed guesses, even for the correct token, and keeps that code for after the lockout', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
        for (let i = 0; i < 5; i++) {
          await expect(attempt(`guess-${i}`)).rejects.toThrow(
            NotFoundException,
          );
        }

        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        const sixth = attempt('raw-reset-token');

        await expect(sixth).rejects.toMatchObject({ status: 429 });
        await expect(sixth).rejects.toBeInstanceOf(HttpException);
        await new Promise((resolve) => setImmediate(resolve));
        expect(authRepository.updateUser).not.toHaveBeenCalled();
        expect(authRepository.deleteToken).not.toHaveBeenCalled();
        expect(authRepository.deleteUserTokensByType).not.toHaveBeenCalled();
      });

      it('charges a mismatched-email guess against the token owner, so rotating emails cannot evade the cap', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
        for (let i = 0; i < 5; i++) {
          await expect(
            service.resetPassword(
              'raw-reset-token',
              `rotating-${i}@example.com`,
              'NewPass1#',
              {
                token: 'raw-reset-token',
                email: `rotating-${i}@example.com`,
                newPassword: 'NewPass1#',
              },
            ),
          ).rejects.toThrow(NotFoundException);
        }

        await expect(attempt('raw-reset-token')).rejects.toMatchObject({
          status: 429,
        });
        expect(authRepository.updateUser).not.toHaveBeenCalled();
      });

      it('revokes only the presented code once mismatched emails exceed the owner cap', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
        for (let i = 0; i < 5; i++) {
          await expect(
            service.resetPassword('raw-reset-token', `r${i}@example.com`, 'x', {
              token: 'raw-reset-token',
              email: `r${i}@example.com`,
              newPassword: 'x',
            }),
          ).rejects.toThrow(NotFoundException);
        }
        expect(authRepository.deleteToken).not.toHaveBeenCalled();

        await expect(
          service.resetPassword('raw-reset-token', 'r5@example.com', 'x', {
            token: 'raw-reset-token',
            email: 'r5@example.com',
            newPassword: 'x',
          }),
        ).rejects.toThrow(NotFoundException);
        await new Promise((resolve) => setImmediate(resolve));
        expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
        expect(authRepository.deleteUserTokensByType).not.toHaveBeenCalled();
      });

      it('answers a mismatched email over the owner cap exactly like an unknown token', async () => {
        const unknownToken = async () => {
          authRepository.findTokenByHashedToken.mockResolvedValueOnce(null);
          return service
            .resetPassword('raw-reset-token', 'probe@example.com', 'x', {
              token: 'raw-reset-token',
              email: 'probe@example.com',
              newPassword: 'x',
            })
            .catch((error: HttpException) => error);
        };
        const expected = await unknownToken();
        redis.reset();
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
        for (let i = 0; i < 5; i++) {
          await service
            .resetPassword('raw-reset-token', `r${i}@example.com`, 'x', {
              token: 'raw-reset-token',
              email: `r${i}@example.com`,
              newPassword: 'x',
            })
            .catch(() => undefined);
          await new Promise((resolve) => setImmediate(resolve));
        }

        const overCap = await service
          .resetPassword('raw-reset-token', 'probe@example.com', 'x', {
            token: 'raw-reset-token',
            email: 'probe@example.com',
            newPassword: 'x',
          })
          .catch((error: HttpException) => error);

        expect(overCap).toBeInstanceOf(NotFoundException);
        expect((overCap as HttpException).getStatus()).toBe(
          (expected as HttpException).getStatus(),
        );
        expect((overCap as HttpException).getResponse()).toEqual(
          (expected as HttpException).getResponse(),
        );
      });

      it('sends the caller charge before the owner charge, so a slow owner command cannot delay the caller verdict', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        const keyOf = (email: string) =>
          `password-reset:misses:${createHash('sha256').update(email).digest('hex')}`;
        const sent: string[] = [];
        const evalOnce = redis.eval;
        jest.spyOn(redis, 'eval').mockImplementation((...args) => {
          sent.push(args[2]);
          return evalOnce(...args);
        });

        await expect(
          service.resetPassword('raw-reset-token', 'other@example.com', 'x', {
            token: 'raw-reset-token',
            email: 'other@example.com',
            newPassword: 'x',
          }),
        ).rejects.toThrow(NotFoundException);
        await new Promise((resolve) => setImmediate(resolve));

        expect(sent).toEqual([
          keyOf('other@example.com'),
          keyOf('other@example.com'),
          keyOf(mockUser.email),
        ]);
      });

      const keyOf = (email: string) =>
        `password-reset:misses:${createHash('sha256').update(email).digest('hex')}`;
      const guessForeign = () =>
        service
          .resetPassword('raw-reset-token', 'other@example.com', 'x', {
            token: 'raw-reset-token',
            email: 'other@example.com',
            newPassword: 'x',
          })
          .catch((error: HttpException) => error.getStatus());

      it('revokes a foreign code when its charge pushes the caller over the cap, charging the owner once', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        redis.seed(keyOf('other@example.com'), 4);
        const evalOnce = redis.eval;
        jest
          .spyOn(redis, 'eval')
          .mockImplementationOnce(async (...args) => {
            const read = await evalOnce(...args);
            redis.seed(keyOf('other@example.com'), 5);
            return read;
          })
          .mockImplementation(evalOnce);

        expect(await guessForeign()).toBe(429);
        await new Promise((resolve) => setImmediate(resolve));

        expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
        expect(redis.failures(keyOf(mockUser.email))).toBe(1);
      });

      it('revokes a foreign code in a concurrent burst that crosses the caller cap', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        redis.seed(keyOf('other@example.com'), 4);

        const statuses = await Promise.all(
          Array.from({ length: 3 }, () => guessForeign()),
        );
        await new Promise((resolve) => setImmediate(resolve));

        expect(statuses.sort()).toEqual([404, 429, 429]);
        expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
      });

      it('keeps an under-cap foreign guess at 404 without revoking the code', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

        expect(await guessForeign()).toBe(404);
        await new Promise((resolve) => setImmediate(resolve));

        expect(authRepository.deleteToken).not.toHaveBeenCalled();
        expect(redis.failures(keyOf(mockUser.email))).toBe(1);
      });

      it('revokes the foreign code even when charging its owner fails', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        let calls = 0;
        jest.spyOn(redis, 'eval').mockImplementation(() => {
          calls++;
          if (calls === 1) return Promise.resolve('4');
          if (calls === 2) return Promise.resolve(6);
          return Promise.reject(new Error('owner charge failed'));
        });

        expect(await guessForeign()).toBe(429);
        await new Promise((resolve) => setImmediate(resolve));

        expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to charge reset token owner (Error)',
        );
      });

      it('logs a failed owner-token delete after an over-cap owner charge without the owner email', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.deleteToken.mockRejectedValue(
          new Error(`db unavailable for ${mockUser.email}`),
        );
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        redis.seed(
          `password-reset:misses:${createHash('sha256').update(mockUser.email).digest('hex')}`,
          5,
        );

        await expect(
          service.resetPassword('raw-reset-token', 'other@example.com', 'x', {
            token: 'raw-reset-token',
            email: 'other@example.com',
            newPassword: 'x',
          }),
        ).rejects.toThrow(NotFoundException);
        await new Promise((resolve) => setImmediate(resolve));

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to charge reset token owner (Error)',
        );
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
          mockUser.email,
        );
        errorSpy.mockRestore();
      });

      it('answers a mismatched email without waiting on the owner charge, which gives up after the deadline', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        const evalOnce = redis.eval;
        jest
          .spyOn(redis, 'eval')
          .mockImplementationOnce(evalOnce)
          .mockImplementationOnce(evalOnce)
          .mockImplementationOnce(() => new Promise(() => undefined))
          .mockImplementation(evalOnce);

        await expect(
          service.resetPassword('raw-reset-token', 'other@example.com', 'x', {
            token: 'raw-reset-token',
            email: 'other@example.com',
            newPassword: 'x',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(errorSpy).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(2000);

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to charge reset token owner (HealthCheckTimeoutError)',
        );
        errorSpy.mockRestore();
        jest.useRealTimers();
      });

      it('gives a legacy counter with no TTL an expiry on the next attempt', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        await expect(attempt('a')).rejects.toThrow(NotFoundException);
        const [key] = [...redis.values.keys()];
        redis.seed(key, 5, null);

        await expect(attempt('b')).rejects.toMatchObject({ status: 429 });

        expect(redis.ttls.get(key)).toBe(3_600_000);
      });

      it('lets the owner try again once the attempt window has passed', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        try {
          authRepository.findTokenByHashedToken.mockResolvedValue(null);
          for (let i = 0; i < 5; i++) {
            await expect(attempt(`guess-${i}`)).rejects.toThrow(
              NotFoundException,
            );
          }
          await expect(attempt('guess-5')).rejects.toMatchObject({
            status: 429,
          });

          jest.advanceTimersByTime(3_600_000);

          await expect(attempt('guess-6')).rejects.toThrow(NotFoundException);
        } finally {
          jest.useRealTimers();
        }
      });

      it('budgets wrong guesses per email: other emails never spend the owner budget, and the owner email stops at five', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        for (let i = 0; i < 20; i++) {
          await expect(
            attempt(`guess-${i}`, `rotated-${i}@example.com`),
          ).rejects.toThrow(NotFoundException);
        }
        for (let i = 0; i < 5; i++) {
          await expect(attempt(`owner-guess-${i}`)).rejects.toThrow(
            NotFoundException,
          );
        }

        await expect(attempt('owner-guess-5')).rejects.toMatchObject({
          status: 429,
        });
      });

      it('lets concurrent guesses through at most 5 times', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);

        const results = await Promise.allSettled(
          Array.from({ length: 20 }, (_, i) => attempt(`guess-${i}`)),
        );

        const lookedUp = results.filter(
          (r) =>
            r.status === 'rejected' && r.reason instanceof NotFoundException,
        );
        expect(lookedUp).toHaveLength(5);
        const lockedOut = results.filter(
          (r) => r.status === 'rejected' && r.reason?.getStatus?.() === 429,
        );
        expect(lockedOut).toHaveLength(15);
        expect(redis.counts()).toEqual([20]);
      });

      it('bounds a burst that passed the read-only cap check: one more wrong guess gets a verdict, every miss is counted, and the valid code in the burst still resets', async () => {
        redis.seed(
          `password-reset:misses:${createHash('sha256').update(mockUser.email).digest('hex')}`,
          4,
        );
        authRepository.findTokenByHashedToken.mockImplementation((hash) =>
          Promise.resolve(hash === 'h:raw-reset-token' ? mockResetToken : null),
        );
        tokenService.hashToken.mockImplementation((code) => `h:${code}`);
        authRepository.updateUser.mockResolvedValue(makeUser());

        const results = await Promise.allSettled([
          ...Array.from({ length: 20 }, (_, i) => attempt(`guess-${i}`)),
          attempt('raw-reset-token'),
        ]);

        const statuses = results.map((r) =>
          r.status === 'fulfilled'
            ? 200
            : (r.reason as HttpException).getStatus(),
        );
        expect(statuses.filter((s) => s === 404)).toHaveLength(1);
        expect(statuses.filter((s) => s === 429)).toHaveLength(19);
        expect(statuses[20]).toBe(200);
        expect(authRepository.updateUser).toHaveBeenCalledTimes(1);
      });

      it('clears the counter after a successful reset', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
        for (let i = 0; i < 4; i++) {
          await expect(attempt(`guess-${i}`)).rejects.toThrow(
            NotFoundException,
          );
        }
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.updateUser.mockResolvedValue(makeUser());

        await attempt('raw-reset-token');

        expect(redis.values.size).toBe(0);
      });
    });
  });

  describe('reset attempt matrix', () => {
    type Presented =
      | 'own-live'
      | 'own-at-expiry'
      | 'own-expired'
      | 'unknown'
      | 'foreign-live'
      | 'foreign-expired';
    type CapState = 'first' | 'last' | 'over';
    type Entry = 'validate' | 'reset';
    type RedisMode =
      | 'up'
      | 'down'
      | 'error'
      | 'slow'
      | 'late'
      | 'offline'
      | 'charge-down'
      | 'charge-error'
      | 'charge-slow'
      | 'charge-late'
      | 'clear-down'
      | 'clear-slow';
    type DbMode =
      | 'ok'
      | 'lookup-fails'
      | 'write-fails'
      | 'sessions-fail'
      | 'cleanup-fails'
      | 'raced';
    type World = { redis: RedisMode; db: DbMode };

    const HEALTHY: World = { redis: 'up', db: 'ok' };
    const WHOLE_LINK: Partial<Record<RedisMode, FakeReply>> = {
      down: 'down',
      error: 'garbage',
      slow: 'slow',
      late: 'late',
    };
    const ONE_COMMAND = (prefix: string): FakeReply => {
      if (!world.redis.startsWith(`${prefix}-`)) return 'ok';
      const mode = world.redis.slice(prefix.length + 1);
      return mode === 'error' ? 'garbage' : (mode as FakeReply);
    };
    const readFails = (w: World) =>
      ['down', 'error', 'slow', 'late', 'offline'].includes(w.redis);
    const chargeLost = (w: World) =>
      ['charge-down', 'charge-error', 'charge-slow'].includes(w.redis);
    const clearFails = (w: World) => w.redis.startsWith('clear-');
    const timed = (w: World) =>
      ['slow', 'late', 'charge-slow', 'charge-late', 'clear-slow'].includes(
        w.redis,
      );
    const NOW = new Date('2026-06-01T12:00:00Z').getTime();
    const ownerA = makeUser({ id: 'user-a', email: 'a@example.com' });
    const ownerB = makeUser({ id: 'user-b', email: 'b@example.com' });
    const priorFailures: Record<CapState, number> = {
      first: 0,
      last: 4,
      over: 5,
    };
    const codeFor: Record<Presented, string> = {
      'own-live': 'a-live',
      'own-at-expiry': 'a-now',
      'own-expired': 'a-old',
      unknown: 'no-such-code',
      'foreign-live': 'b-live',
      'foreign-expired': 'b-old',
    };
    const DB_DOWN = 'db unavailable for a@example.com and b@example.com';
    const counterKey = (email: string) =>
      `password-reset:misses:${createHash('sha256').update(email).digest('hex')}`;

    let tokens: Map<string, TokenWithUser>;
    let repoCalls: string[];
    let committed: string[];
    let world: World;

    const seedToken = (
      code: string,
      owner: typeof ownerA,
      expiresInMs: number,
    ) =>
      tokens.set(code, {
        ...makeToken({
          id: `id-${code}`,
          userId: owner.id,
          token: `h:${code}`,
          type: TokenType.PASSWORD_RESET,
          expiresAt: new Date(NOW + expiresInMs),
        }),
        user: owner,
      });

    const seedAll = () => {
      tokens = new Map();
      committed = [];
      seedToken('a-live', ownerA, 3600_000);
      seedToken('a-now', ownerA, 0);
      seedToken('a-old', ownerA, -3600_000);
      seedToken('b-live', ownerB, 3600_000);
      seedToken('b-old', ownerB, -3600_000);
    };

    const flush = async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    const applyWorld = (w: World) => {
      world = w;
      redis.online = w.redis !== 'offline';
      const whole = WHOLE_LINK[w.redis];
      redis.readReply = whole ?? 'ok';
      redis.chargeReply = whole ?? ONE_COMMAND('charge');
      redis.writeReply = whole ?? ONE_COMMAND('clear');
    };

    beforeEach(() => {
      repoCalls = [];
      world = HEALTHY;
      seedAll();

      const users = [ownerA, ownerB];
      const record =
        <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
        (...args: A) => {
          repoCalls.push(name);
          return fn(...args);
        };
      const removeWhere = (match: (t: TokenWithUser) => boolean) => {
        let removed = 0;
        for (const [code, t] of tokens)
          if (match(t)) {
            tokens.delete(code);
            removed++;
          }
        return removed;
      };
      const dbDown = () => Promise.reject(new Error(DB_DOWN));
      (bcrypt.hash as jest.Mock).mockImplementation(
        record('bcrypt.hash', () => Promise.resolve('hashed-password')),
      );
      tokenService.hashToken.mockImplementation((code: string) => `h:${code}`);
      authRepository.findUserByEmailIgnoringCase.mockImplementation(
        record('findUserByEmail', (email: string) =>
          Promise.resolve(users.find((u) => u.email === email) ?? null),
        ),
      );
      authRepository.findTokenByHashedToken.mockImplementation(
        record('findTokenByHashedToken', (hash: string) => {
          if (world.db === 'lookup-fails') return dbDown();
          const found =
            [...tokens.values()].find((t) => t.token === hash) ?? null;
          if (found && world.db === 'raced') removeWhere((t) => t === found);
          return new Promise((resolve) => setImmediate(() => resolve(found)));
        }),
      );
      authRepository.deleteToken.mockImplementation(
        record('deleteToken', (id: string) => {
          if (world.db === 'cleanup-fails') return dbDown();
          removeWhere((t) => t.id === id);
          return Promise.resolve();
        }),
      );
      authRepository.deleteUserTokensByType.mockImplementation(
        record('deleteUserTokensByType', (userId: string) => {
          removeWhere((t) => t.userId === userId);
          return Promise.resolve();
        }),
      );
      authRepository.updateUser.mockImplementation(
        record('updateUser', () => Promise.resolve(ownerA)),
      );
      authRepository.deleteAllUserSessions.mockImplementation(
        record('deleteAllUserSessions', () => Promise.resolve()),
      );
      authRepository.transaction.mockImplementation(
        record('transaction', async (fn) => {
          const snapshot = new Map(tokens);
          const pending: string[] = [];
          const tx = {
            consumeToken: record('tx.consumeToken', (id: string) =>
              Promise.resolve(removeWhere((t) => t.id === id) > 0),
            ),
            updateUser: record('tx.updateUser', () => {
              if (world.db === 'write-fails') return dbDown();
              pending.push('updateUser');
              return Promise.resolve(ownerA);
            }),
            deleteAllUserSessions: record('tx.deleteAllUserSessions', () => {
              if (world.db === 'sessions-fail') return dbDown();
              pending.push('deleteAllUserSessions');
              return Promise.resolve();
            }),
          } as unknown as IAuthRepositoryTransaction;
          try {
            const result = await fn(tx);
            committed.push(...pending);
            return result;
          } catch (error) {
            tokens = snapshot;
            throw error;
          }
        }),
      );
    });

    const statusOf = (work: Promise<unknown>) =>
      work.then(
        () => 200,
        (error: unknown) =>
          error instanceof HttpException ? error.getStatus() : 500,
      );

    const call = (entry: Entry, code: string, email: string) =>
      entry === 'validate'
        ? service.validateResetToken(code, email, { token: code, email })
        : service.resetPassword(code, email, 'NewPass1#', {
            token: code,
            email,
            newPassword: 'NewPass1#',
          });

    const run = async (
      entry: Entry,
      email: string,
      presented: Presented,
      state: CapState,
      w: World = HEALTHY,
    ) => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] });
      try {
        applyWorld(w);
        seedAll();
        redis.reset();
        redis.seed(counterKey('a@example.com'), priorFailures[state]);
        const callerKey = counterKey(email.trim().toLowerCase());
        if (callerKey !== counterKey('a@example.com')) {
          redis.seed(callerKey, priorFailures[state]);
        }
        let preResponseCalls: string[] = [];
        const settled = call(entry, codeFor[presented], email).then(
          (body): { status: number; body: unknown } => {
            preResponseCalls = [...repoCalls];
            return { status: 200, body };
          },
          (error: unknown) => {
            preResponseCalls = [...repoCalls];
            if (!(error instanceof HttpException)) {
              return {
                status: 500,
                body: error instanceof Error ? error.message : error,
              };
            }
            return { status: error.getStatus(), body: error.getResponse() };
          },
        );
        if (timed(w)) {
          await flush();
          await jest.advanceTimersByTimeAsync(5000);
        }
        const outcome = await settled;
        if (w.redis === 'offline') redis.reconnect();
        await flush();
        if (timed(w)) await jest.advanceTimersByTimeAsync(5000);
        await flush();
        const after = {
          ...outcome,
          preResponseCalls,
          applied: [...redis.applied],
          remaining: [...tokens.keys()].sort(),
          counter: redis.failures(callerKey),
          counterA: redis.failures(counterKey('a@example.com')),
          counterB: redis.failures(counterKey('b@example.com')),
          committed: [...committed],
        };
        applyWorld(HEALTHY);
        const followUp = await statusOf(
          call(entry, codeFor['own-live'], 'a@example.com'),
        );
        await flush();
        return { ...after, followUp };
      } finally {
        jest.useRealTimers();
      }
    };

    const NOT_FOUND = new NotFoundException(
      'Invalid reset token',
    ).getResponse();
    const EXPIRED = new UnauthorizedException(
      'Reset token has expired',
    ).getResponse();
    const LOCKED = new HttpException(
      'Too many failed reset attempts. Try again later.',
      429,
    ).getResponse();
    const UNAVAILABLE = new ServiceUnavailableException(
      'Password reset is temporarily unavailable. Try again later.',
    ).getResponse();
    const ALL = ['a-live', 'a-now', 'a-old', 'b-live', 'b-old'];
    const LOG_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose'] as const;
    const SECRETS = [
      'a@example.com',
      'A@Example.com',
      'b@example.com',
      'ghost@example.com',
      ...Object.values(codeFor),
    ];
    const without = (...codes: string[]) =>
      ALL.filter((c) => !codes.includes(c));

    type Expected = {
      status: number;
      body: unknown;
      remaining: string[];
      counter: number | undefined;
      counterA: number | undefined;
      counterB: number | undefined;
      committed: string[];
      followUp: number;
    };

    const outcomeFor = (
      entry: Entry,
      presented: Presented,
      state: CapState,
      w: World,
    ): Omit<Expected, 'followUp' | 'counterA'> => {
      if (w.db === 'cleanup-fails') {
        const healthyDb = outcomeFor(entry, presented, state, {
          ...w,
          db: 'ok',
        });
        const consumed = healthyDb.committed.length > 0 ? ['a-live'] : [];
        return { ...healthyDb, remaining: without(...consumed) };
      }
      const prior = priorFailures[state];
      const code = codeFor[presented];
      const foreign = presented.startsWith('foreign');
      const raced = w.db === 'raced' ? [code] : [];
      const ownerCharged = foreign && !chargeLost(w) ? 1 : undefined;
      const answer = (
        status: number,
        body: unknown,
        remaining: string[],
        counter: number | undefined,
        counterB: number | undefined = undefined,
        committed: string[] = [],
      ) => ({ status, body, remaining, counter, counterB, committed });
      const cleared = clearFails(w) ? prior : undefined;

      if (readFails(w)) return answer(503, UNAVAILABLE, ALL, prior);
      if (state === 'over') {
        const revoked = foreign && w.db !== 'lookup-fails';
        return answer(
          429,
          LOCKED,
          revoked ? without(code) : without(...raced),
          prior,
          revoked ? ownerCharged : undefined,
        );
      }
      if (w.db === 'lookup-fails') {
        return answer(500, DB_DOWN, ALL, prior);
      }
      if (presented === 'own-live') {
        if (entry === 'validate') {
          return answer(
            200,
            { message: 'Valid reset token' },
            without(...raced),
            cleared,
          );
        }
        if (w.db === 'raced')
          return answer(404, NOT_FOUND, without('a-live'), prior);
        if (w.db === 'write-fails' || w.db === 'sessions-fail') {
          return answer(500, DB_DOWN, ALL, prior);
        }
        return answer(
          200,
          { message: 'Password has been reset successfully' },
          without('a-live'),
          cleared,
          undefined,
          ['updateUser', 'deleteAllUserSessions'],
        );
      }
      const expired =
        presented === 'own-at-expiry' || presented === 'own-expired';
      if (chargeLost(w) || w.redis === 'charge-late') {
        return answer(
          503,
          UNAVAILABLE,
          without(...raced),
          w.redis === 'charge-late' ? prior + 1 : prior,
          ownerCharged,
        );
      }
      return answer(
        expired ? 401 : 404,
        expired ? EXPIRED : NOT_FOUND,
        expired ? without(code) : without(...raced),
        prior + 1,
        ownerCharged,
      );
    };

    const expectedFor = (
      entry: Entry,
      presented: Presented,
      state: CapState,
      w: World,
      ownsA: boolean,
    ): Expected => {
      const outcome = outcomeFor(entry, presented, state, w);
      const ownerCounter = ownsA ? outcome.counter : priorFailures[state];
      const followUp =
        (ownerCounter ?? 0) >= 5
          ? 429
          : outcome.remaining.includes('a-live')
            ? 200
            : 404;
      return { ...outcome, counterA: ownerCounter, followUp };
    };

    const emails = [
      {
        label: 'owner email',
        email: 'a@example.com',
        ownsA: true,
        casing: false,
      },
      {
        label: 'owner email in other casing',
        email: 'A@Example.com',
        ownsA: true,
        casing: true,
      },
      {
        label: 'email with no account',
        email: 'ghost@example.com',
        ownsA: false,
        casing: false,
      },
    ];
    const presentedCases: Presented[] = [
      'own-live',
      'own-at-expiry',
      'own-expired',
      'unknown',
      'foreign-live',
      'foreign-expired',
    ];
    const dbModes: DbMode[] = [
      'ok',
      'lookup-fails',
      'write-fails',
      'sessions-fail',
      'cleanup-fails',
      'raced',
    ];
    const redisModes: RedisMode[] = [
      'up',
      'down',
      'error',
      'slow',
      'late',
      'offline',
      'charge-down',
      'charge-error',
      'charge-slow',
      'charge-late',
      'clear-down',
      'clear-slow',
    ];
    const worlds: World[] = redisModes.flatMap((mode) =>
      dbModes.map((db): World => ({ redis: mode, db })),
    );
    const describeWorld = ({ redis: mode, db }: World) =>
      `redis ${mode}, db ${db}`;
    const rows = worlds.flatMap((w) =>
      (['validate', 'reset'] as Entry[]).flatMap((entry) =>
        emails
          .filter(({ casing }) => !casing || w.redis === 'up')
          .flatMap(({ label, email, ownsA }) =>
            (['first', 'last', 'over'] as CapState[]).flatMap((state) =>
              presentedCases
                .filter((p) => ownsA || !p.startsWith('own'))
                .map((presented) => ({
                  entry,
                  label,
                  email,
                  presented,
                  state,
                  world: w,
                  worldLabel: describeWorld(w),
                  expected: expectedFor(entry, presented, state, w, ownsA),
                })),
            ),
          ),
      ),
    );

    it.each(rows)(
      '$worldLabel / $entry: $label, $state attempt, $presented code',
      async ({ entry, email, presented, state, world: w, expected }) => {
        const spies = LOG_LEVELS.map((level) =>
          jest
            .spyOn(Logger.prototype, level)
            .mockImplementation(() => undefined),
        );
        const result = await run(entry, email, presented, state, w);
        const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
        spies.forEach((spy) => spy.mockRestore());

        if (presented === 'own-live' && state !== 'over' && w.db !== 'raced') {
          expect(result.followUp).toBe(
            result.remaining.includes('a-live') ? 200 : 404,
          );
        }
        if (result.status === 404 || result.status === 401) {
          expect(result.counter).toBeLessThanOrEqual(5);
        }
        for (const secret of SECRETS) expect(logged).not.toContain(secret);
        expect({
          status: result.status,
          body: result.body,
          remaining: result.remaining,
          counter: result.counter,
          counterA: result.counterA,
          counterB: result.counterB,
          committed: result.committed,
          followUp: result.followUp,
        }).toEqual(expected);
      },
    );

    it('keeps a wrong guess whose charge reply is lost: Redis counted it once, the caller gets 503, and the fifth such miss locks the owner like any other', async () => {
      const result = await run('validate', 'a@example.com', 'unknown', 'last', {
        redis: 'charge-late',
        db: 'ok',
      });

      expect(result.status).toBe(503);
      expect(result.applied.filter((op) => op === 'charge')).toHaveLength(1);
      expect(result.counter).toBe(5);
      expect(result.followUp).toBe(429);
    });

    it('never writes the counter for a valid code, so a lost reply cannot lock out a valid code', async () => {
      const result = await run('reset', 'a@example.com', 'own-live', 'last', {
        redis: 'charge-late',
        db: 'write-fails',
      });

      expect(result.status).toBe(500);
      expect(result.applied).toEqual(['read']);
      expect(result.counter).toBe(4);
      expect(result.followUp).toBe(200);
    });

    it('sends no counter command while the client is reconnecting, so nothing replays on reconnect', async () => {
      const result = await run('reset', 'a@example.com', 'unknown', 'last', {
        ...HEALTHY,
        redis: 'offline',
      });

      expect(result.status).toBe(503);
      expect(result.applied).toEqual([]);
    });

    it('never sends a counter write for a valid code until the reset commits', async () => {
      const result = await run('reset', 'a@example.com', 'own-live', 'last', {
        ...HEALTHY,
        db: 'write-fails',
      });

      expect(result.status).toBe(500);
      expect(result.applied).toEqual(['read']);
      expect(result.followUp).toBe(200);
    });

    it('sends no counter clear while the client is reconnecting, so a stale delete cannot erase a newer count', async () => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] });
      try {
        jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        const evalOnce = redis.eval;
        jest
          .spyOn(redis, 'eval')
          .mockImplementationOnce((...args) => {
            const read = evalOnce(...args);
            redis.disconnect();
            return read;
          })
          .mockImplementation(evalOnce);

        const pending = statusOf(
          call('reset', codeFor['own-live'], 'a@example.com'),
        );
        await flush();
        await jest.advanceTimersByTimeAsync(5000);
        const status = await pending;
        redis.seed(counterKey('a@example.com'), 3);
        redis.reconnect();
        await flush();

        expect(status).toBe(200);
        expect(committed).toEqual(['updateUser', 'deleteAllUserSessions']);
        expect(redis.applied).not.toContain('del');
        expect(redis.failures(counterKey('a@example.com'))).toBe(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps the background owner charge for a foreign code when the link drops before the caller is charged', async () => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const evalOnce = redis.eval;
        jest
          .spyOn(redis, 'eval')
          .mockImplementationOnce((...args) => {
            const read = evalOnce(...args);
            redis.disconnect();
            return read;
          })
          .mockImplementation(evalOnce);

        const status = await statusOf(
          call('validate', codeFor['foreign-live'], 'a@example.com'),
        );
        redis.reconnect();
        await flush();

        expect(status).toBe(503);
        expect(redis.failures(counterKey('a@example.com'))).toBeUndefined();
        expect(redis.failures(counterKey('b@example.com'))).toBe(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it.each(
      (['validate', 'reset'] as Entry[]).flatMap((entry) =>
        emails.flatMap(({ label, email }) =>
          (['first', 'last', 'over'] as CapState[]).map((state) => ({
            entry,
            label,
            email,
            state,
          })),
        ),
      ),
    )(
      '$entry: $label, $state attempt answers foreign and unknown codes alike',
      async ({ entry, email, state }) => {
        const answers = [];
        for (const presented of [
          'unknown',
          'foreign-live',
          'foreign-expired',
        ] as Presented[]) {
          repoCalls = [];
          const { status, body, preResponseCalls } = await run(
            entry,
            email,
            presented,
            state,
          );
          answers.push({ status, body, preResponseCalls });
        }

        expect(answers[1]).toEqual(answers[0]);
        expect(answers[2]).toEqual(answers[0]);
      },
    );

    it('hashes the new password before claiming the code, then claims, writes and logs out in one transaction', async () => {
      const result = await run('reset', 'a@example.com', 'own-live', 'first');

      expect(result.status).toBe(200);
      expect(result.preResponseCalls).toEqual([
        'findTokenByHashedToken',
        'bcrypt.hash',
        'transaction',
        'tx.consumeToken',
        'tx.updateUser',
        'tx.deleteAllUserSessions',
      ]);
    });

    it('revokes a foreign code presented over the cap even when charging its owner fails', async () => {
      const evalOnce = redis.eval;
      jest
        .spyOn(redis, 'eval')
        .mockImplementationOnce(evalOnce)
        .mockImplementationOnce(() =>
          Promise.reject(new Error('Connection is closed.')),
        )
        .mockImplementation(evalOnce);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const result = await run(
        'reset',
        'a@example.com',
        'foreign-live',
        'over',
      );

      expect(result.status).toBe(429);
      expect(result.remaining).toEqual(without('b-live'));
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to charge reset token owner (Error)',
      );
      errorSpy.mockRestore();
    });

    it('logs a failed revocation over the cap without changing the 429', async () => {
      authRepository.deleteToken.mockRejectedValue(
        Object.assign(new Error('db unavailable for b@example.com'), {
          code: 'P1001',
        }),
      );
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const result = await run(
        'reset',
        'a@example.com',
        'foreign-live',
        'over',
      );

      expect(result.status).toBe(429);
      expect(result.body).toEqual(LOCKED);
      expect(result.counterB).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to revoke presented reset code (P1001)',
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        'b@example.com',
      );
      errorSpy.mockRestore();
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
      authRepository.findUserById.mockResolvedValue(mockUser);
      authRepository.transaction.mockImplementation(async (fn) => {
        const tx: jest.Mocked<IAuthRepositoryTransaction> = {
          consumeToken: jest.fn(),
          updateUser: jest.fn().mockResolvedValue(makeUser()),
          deleteAllUserSessions: jest.fn(),
          markEmailVerified: jest.fn(),
          deleteOtherSessions: jest.fn().mockResolvedValue(undefined),
          findActiveUserLinkedProviderFields: jest.fn().mockResolvedValue(null),
          unlinkProviderField: jest.fn().mockResolvedValue(undefined),
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
      authRepository.findUserById.mockResolvedValue(mockUser);
      authRepository.transaction.mockImplementation(async (fn) => {
        const tx: jest.Mocked<IAuthRepositoryTransaction> = {
          consumeToken: jest.fn(),
          updateUser: jest.fn().mockResolvedValue(makeUser()),
          deleteAllUserSessions: jest.fn(),
          markEmailVerified: jest.fn(),
          deleteOtherSessions: jest.fn().mockResolvedValue(undefined),
          findActiveUserLinkedProviderFields: jest.fn().mockResolvedValue(null),
          unlinkProviderField: jest.fn().mockResolvedValue(undefined),
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
      authRepository.findUserById.mockResolvedValue(mockUser);
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
      authRepository.findUserById.mockResolvedValue(mockUser);
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
      authRepository.findUserById.mockResolvedValue(mockUser);
      const mockTxUpdateUser = jest.fn().mockResolvedValue(makeUser());
      const mockTxDeleteOtherSessions = jest.fn().mockResolvedValue(undefined);
      authRepository.transaction.mockImplementation(async (fn) => {
        const tx: jest.Mocked<IAuthRepositoryTransaction> = {
          consumeToken: jest.fn(),
          updateUser: mockTxUpdateUser,
          deleteAllUserSessions: jest.fn(),
          markEmailVerified: jest.fn(),
          deleteOtherSessions: mockTxDeleteOtherSessions,
          findActiveUserLinkedProviderFields: jest.fn().mockResolvedValue(null),
          unlinkProviderField: jest.fn().mockResolvedValue(undefined),
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
