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
import { HttpException } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service';

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
  let redisStore: Map<string, number>;
  let redisTtls: Map<string, number>;

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

    const mockTokenService: Partial<jest.Mocked<TokenService>> = {
      hashToken: jest.fn().mockReturnValue('hashed-reset-token'),
    };

    const mockEventEmitter: Partial<jest.Mocked<EventEmitter2>> = {
      emit: jest.fn(),
    };

    redisStore = new Map<string, number>();
    redisTtls = new Map<string, number>();
    const mockRedis = {
      client: {
        multi: jest.fn(() => {
          const ops: Array<() => number | string | null> = [];
          const chain = {
            set: (
              key: string,
              _v: number,
              _ex: 'EX',
              ttl: number,
              nx?: 'NX',
            ) => {
              ops.push(() => {
                if (nx === 'NX' && redisStore.has(key)) return null;
                redisStore.set(key, 0);
                redisTtls.set(key, ttl);
                return 'OK';
              });
              return chain;
            },
            incr: (key: string) => {
              ops.push(() => {
                const next = (redisStore.get(key) ?? 0) + 1;
                redisStore.set(key, next);
                return next;
              });
              return chain;
            },
            ttl: (key: string) => {
              ops.push(() => redisTtls.get(key) ?? -1);
              return chain;
            },
            exec: () =>
              Promise.resolve(ops.map((op) => [null, op()] as [null, unknown])),
          };
          return chain;
        }),
        expire: jest.fn((key: string, ttl: number) => {
          redisTtls.set(key, ttl);
          return Promise.resolve(1);
        }),
        del: jest.fn((key: string) => {
          redisStore.delete(key);
          redisTtls.delete(key);
          return Promise.resolve(1);
        }),
      },
    };

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
    it('should create reset token and emit event for existing user', async () => {
      // Arrange
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue(makeToken());

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

    it('should alert but NOT record IP when reset requested from an unfamiliar IP', async () => {
      // Arrange
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      expect(redisStore.size).toBe(1);
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

      expect(redisStore.size).toBe(0);
    });

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
      expect([...redisStore.values()]).toEqual([3]);
    });

    it('sets a TTL on the counter in the same atomic operation as the first failure', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(
        service.validateResetToken('x', 'test@example.com', {
          token: 'x',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
      expect([...redisTtls.values()]).toEqual([3600]);
    });

    it('does not tell the caller a fresh code unlocks them', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
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
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
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
    });

    describe('attempt cap', () => {
      const attempt = (token: string) =>
        service.resetPassword(token, 'test@example.com', 'NewPass1#', {
          token,
          email: 'test@example.com',
          newPassword: 'NewPass1#',
        });

      it('locks out and invalidates the user token after 5 failed guesses, even for the correct token', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        authRepository.findUserByEmail.mockResolvedValue(mockUser);
        for (let i = 0; i < 5; i++) {
          await expect(attempt(`guess-${i}`)).rejects.toThrow(
            NotFoundException,
          );
        }

        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        const sixth = attempt('raw-reset-token');

        await expect(sixth).rejects.toMatchObject({ status: 429 });
        await expect(sixth).rejects.toBeInstanceOf(HttpException);
        expect(authRepository.updateUser).not.toHaveBeenCalled();
        expect(authRepository.deleteUserTokensByType).toHaveBeenCalledWith(
          'user-1',
          TokenType.PASSWORD_RESET,
        );
      });

      it('charges a mismatched-email guess against the token owner, so rotating emails cannot evade the cap', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.findUserByEmail.mockResolvedValue(mockUser);
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

      it('locks the token owner out from charges made through other emails alone', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.findUserByEmail.mockResolvedValue(mockUser);
        for (let i = 0; i < 5; i++) {
          await expect(
            service.resetPassword('raw-reset-token', `r${i}@example.com`, 'x', {
              token: 'raw-reset-token',
              email: `r${i}@example.com`,
              newPassword: 'x',
            }),
          ).rejects.toThrow(NotFoundException);
        }
        expect(authRepository.deleteUserTokensByType).not.toHaveBeenCalled();

        await expect(
          service.resetPassword('raw-reset-token', 'r5@example.com', 'x', {
            token: 'raw-reset-token',
            email: 'r5@example.com',
            newPassword: 'x',
          }),
        ).rejects.toMatchObject({ status: 429 });
        expect(authRepository.deleteUserTokensByType).toHaveBeenCalledWith(
          'user-1',
          TokenType.PASSWORD_RESET,
        );
      });

      it('gives a legacy counter with no TTL an expiry on the next attempt', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        await expect(attempt('a')).rejects.toThrow(NotFoundException);
        redisTtls.clear();
        const [key] = [...redisStore.keys()];
        redisStore.set(key, 6);

        await expect(attempt('b')).rejects.toMatchObject({ status: 429 });

        expect(redisTtls.get(key)).toBe(3600);
      });

      it('lets concurrent guesses through at most 5 times', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        authRepository.findUserByEmail.mockResolvedValue(mockUser);

        const results = await Promise.allSettled(
          Array.from({ length: 20 }, (_, i) => attempt(`guess-${i}`)),
        );

        const lookedUp = results.filter(
          (r) =>
            r.status === 'rejected' && r.reason instanceof NotFoundException,
        );
        expect(lookedUp).toHaveLength(5);
        expect(authRepository.findTokenByHashedToken).toHaveBeenCalledTimes(5);
      });

      it('clears the counter after a successful reset', async () => {
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        authRepository.findUserByEmail.mockResolvedValue(mockUser);
        for (let i = 0; i < 4; i++) {
          await expect(attempt(`guess-${i}`)).rejects.toThrow(
            NotFoundException,
          );
        }
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.updateUser.mockResolvedValue(makeUser());

        await attempt('raw-reset-token');

        expect(redisStore.size).toBe(0);
      });
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
          updateUser: jest.fn().mockResolvedValue(makeUser()),
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
          updateUser: jest.fn().mockResolvedValue(makeUser()),
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
          updateUser: mockTxUpdateUser,
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
