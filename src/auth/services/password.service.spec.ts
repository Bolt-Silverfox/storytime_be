import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  Logger,
  HttpException,
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
import { Role, OnboardingStatus, Prisma } from '@prisma/client';
import { RedisService } from '@/redis/redis.service';
import { FakeRedisClient } from '@/shared/testing/fake-redis';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import * as bcrypt from 'bcryptjs';

jest.mock('@/shared/utils/generate-token', () => ({
  generateResetCode: jest.fn().mockReturnValue({
    token: 'raw-reset-token',
    expiresAt: new Date('2026-03-01T00:00:00Z'),
  }),
}));

import { generateResetCode } from '@/shared/utils/generate-token';

describe('PasswordService', () => {
  let service: PasswordService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let fakeRedis: FakeRedisClient;
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
      findUserById: jest.fn(),
      deleteUserTokensByType: jest.fn(),
      createToken: jest.fn(),
      findTokenByHashedToken: jest.fn(),
      findTokensByUserEmail: jest.fn().mockResolvedValue([]),
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

    fakeRedis = new FakeRedisClient();
    const mockRedis = { client: fakeRedis };

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

    describe('code issuance', () => {
      beforeEach(() => {
        authRepository.findUserByEmail.mockResolvedValue(mockUser);
        authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
        authRepository.createToken.mockResolvedValue(makeToken());
      });

      const uniqueViolation = () =>
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        });

      it('emails an 8-digit code', async () => {
        const actual = jest.requireActual<
          typeof import('@/shared/utils/generate-token')
        >('@/shared/utils/generate-token');
        (generateResetCode as jest.Mock).mockImplementationOnce(
          actual.generateResetCode,
        );

        await service.requestPasswordReset({ email: 'test@example.com' });

        const [, payload] = eventEmitter.emit.mock.calls.find(
          ([name]) => name === 'password.reset_requested',
        ) as [string, { resetToken: string }];
        expect(payload.resetToken).toMatch(/^\d{8}$/);
      });

      it('draws a new code when the stored hash collides with another token', async () => {
        (generateResetCode as jest.Mock)
          .mockReturnValueOnce({ token: 'code-a', expiresAt: new Date() })
          .mockReturnValueOnce({ token: 'code-b', expiresAt: new Date() });
        tokenService.hashToken.mockImplementation((t) => `h:${t}`);
        authRepository.createToken
          .mockRejectedValueOnce(uniqueViolation())
          .mockResolvedValueOnce(makeToken());

        await expect(
          service.requestPasswordReset({ email: 'test@example.com' }),
        ).resolves.toEqual({ message: 'Password reset token sent' });

        expect(authRepository.createToken).toHaveBeenCalledTimes(2);
        expect(authRepository.createToken).toHaveBeenLastCalledWith(
          expect.objectContaining({ token: 'h:code-b' }),
        );
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'password.reset_requested',
          expect.objectContaining({ resetToken: 'code-b' }),
        );
      });

      it('never emails a code whose token failed to persist', async () => {
        (generateResetCode as jest.Mock)
          .mockReturnValueOnce({ token: 'code-a', expiresAt: new Date() })
          .mockReturnValueOnce({ token: 'code-b', expiresAt: new Date() });
        authRepository.createToken
          .mockRejectedValueOnce(uniqueViolation())
          .mockResolvedValueOnce(makeToken());

        await service.requestPasswordReset({ email: 'test@example.com' });

        expect(eventEmitter.emit).not.toHaveBeenCalledWith(
          'password.reset_requested',
          expect.objectContaining({ resetToken: 'code-a' }),
        );
      });

      it('gives up with the original error after repeated collisions', async () => {
        authRepository.createToken.mockRejectedValue(uniqueViolation());

        await expect(
          service.requestPasswordReset({ email: 'test@example.com' }),
        ).rejects.toThrow('Unique constraint failed');

        expect(authRepository.createToken).toHaveBeenCalledTimes(5);
        expect(eventEmitter.emit).not.toHaveBeenCalledWith(
          'password.reset_requested',
          expect.anything(),
        );
      });

      it('does not retry unrelated persistence errors', async () => {
        authRepository.createToken.mockRejectedValue(new Error('db down'));

        await expect(
          service.requestPasswordReset({ email: 'test@example.com' }),
        ).rejects.toThrow('db down');

        expect(authRepository.createToken).toHaveBeenCalledTimes(1);
      });

      it('does not retry Prisma errors other than a unique violation', async () => {
        authRepository.createToken.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Foreign key failed', {
            code: 'P2003',
            clientVersion: 'test',
          }),
        );

        await expect(
          service.requestPasswordReset({ email: 'test@example.com' }),
        ).rejects.toThrow('Foreign key failed');

        expect(authRepository.createToken).toHaveBeenCalledTimes(1);
      });
    });

    describe('issuance cap', () => {
      const request = (email = 'test@example.com') =>
        service.requestPasswordReset({ email });

      beforeEach(() => {
        authRepository.findUserByEmail.mockResolvedValue(mockUser);
        authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
        authRepository.createToken.mockResolvedValue(makeToken());
      });

      it('issues at most 5 codes per email per hour', async () => {
        for (let i = 0; i < 8; i++) await request();

        expect(authRepository.createToken).toHaveBeenCalledTimes(5);
        expect(eventEmitter.emit).toHaveBeenCalledTimes(5);
      });

      it('answers over the cap exactly like a successful request', async () => {
        for (let i = 0; i < 5; i++) await request();

        await expect(request()).resolves.toEqual({
          message: 'Password reset token sent',
        });
      });

      it('does not reveal whether the email exists once over the cap', async () => {
        authRepository.findUserByEmail.mockResolvedValue(null);
        for (let i = 0; i < 5; i++) {
          await expect(request('ghost@example.com')).rejects.toThrow(
            NotFoundException,
          );
        }

        authRepository.findUserByEmail.mockClear();

        await expect(request('ghost@example.com')).resolves.toEqual({
          message: 'Password reset token sent',
        });

        expect(authRepository.findUserByEmail).not.toHaveBeenCalled();
      });

      it('shares one counter across email casing and whitespace', async () => {
        for (const e of ['a@example.com', 'A@Example.com', ' a@example.com ']) {
          await request(e);
        }

        expect(fakeRedis.counts()).toEqual([3]);
      });

      it('counts each email separately and sets a TTL with the first request', async () => {
        await request('one@example.com');
        await request('two@example.com');

        expect(fakeRedis.counts()).toEqual([1, 1]);
        expect([...fakeRedis.ttls.values()]).toEqual([3_600_000, 3_600_000]);
      });

      it.each([
        ['unreachable', 'down'],
        ['returning a non-integer reply', 'garbage'],
        ['stalled', 'slow'],
      ] as const)(
        'answers 503 and issues no code while the issuance counter is %s',
        async (_label, reply) => {
          jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
          jest
            .spyOn(Logger.prototype, 'error')
            .mockImplementation(() => undefined);
          fakeRedis.chargeReply = reply;

          const outcome = request().catch((error: unknown) => error);
          await jest.advanceTimersByTimeAsync(2000);

          await expect(outcome).resolves.toBeInstanceOf(
            ServiceUnavailableException,
          );
          expect(authRepository.findUserByEmail).not.toHaveBeenCalled();
          expect(authRepository.createToken).not.toHaveBeenCalled();
          expect(eventEmitter.emit).not.toHaveBeenCalled();
          jest.useRealTimers();
          jest.restoreAllMocks();
        },
      );

      it('answers 503 without queueing the issuance charge while Redis is reconnecting', async () => {
        fakeRedis.link = 'offline';

        await expect(request()).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        fakeRedis.reconnect();
        await new Promise((resolve) => setImmediate(resolve));

        expect(fakeRedis.applied).toEqual([]);
        expect(authRepository.createToken).not.toHaveBeenCalled();
      });

      it('leaves the existing code untouched when over the cap', async () => {
        for (let i = 0; i < 5; i++) await request();
        authRepository.deleteUserTokensByType.mockClear();

        await request();

        expect(authRepository.deleteUserTokensByType).not.toHaveBeenCalled();
      });
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
    const validate = (token: string, email: string) =>
      service.validateResetToken(token, email, { token, email });

    const stubActiveToken = (id = 'token-1') => {
      authRepository.findTokensByUserEmail.mockResolvedValue([
        makeToken({ id, type: TokenType.PASSWORD_RESET }),
      ]);
    };

    const counterKeys = () => [...fakeRedis.hashes.keys()];

    it('rejects a live token with a wrong email exactly like an unknown token', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      await expect(
        validate('raw-reset-token', 'throwaway@example.com'),
      ).rejects.toThrow(new NotFoundException('Invalid reset token'));
    });

    it('invalidates the active token after 5 wrong guesses and answers with the unknown-token 404', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      for (let i = 0; i < 4; i++) {
        await expect(validate(`g${i}`, 'test@example.com')).rejects.toThrow(
          NotFoundException,
        );
      }
      expect(authRepository.deleteToken).not.toHaveBeenCalled();

      await expect(validate('g4', 'test@example.com')).rejects.toThrow(
        new NotFoundException('Invalid reset token'),
      );

      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
      expect(authRepository.deleteUserTokensByType).not.toHaveBeenCalled();
    });

    it('refuses further guesses once the cap is hit, even with the correct code', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      for (let i = 0; i < 5; i++) {
        await expect(validate(`g${i}`, 'test@example.com')).rejects.toThrow(
          NotFoundException,
        );
      }
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      const err: unknown = await validate(
        'raw-reset-token',
        'test@example.com',
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getStatus()).toBe(404);
      expect((err as NotFoundException).message).toBe('Invalid reset token');
    });

    it('charges mismatched-email guesses to the token owner, so rotating emails cannot evade the cap', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      authRepository.findUserByEmail.mockResolvedValue(null);
      for (let i = 0; i < 5; i++) {
        await expect(
          validate('raw-reset-token', `t${i}@example.com`),
        ).rejects.toThrow(new NotFoundException('Invalid reset token'));
      }
      await new Promise((resolve) => setImmediate(resolve));

      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });

    it('does not charge anything for an email with no active reset token', async () => {
      authRepository.findUserByEmail.mockResolvedValue(null);
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      for (let i = 0; i < 20; i++) {
        await expect(validate(`g${i}`, 'nobody@example.com')).rejects.toThrow(
          NotFoundException,
        );
      }

      expect(counterKeys()).toHaveLength(0);
      expect(authRepository.deleteToken).not.toHaveBeenCalled();
    });

    it('lets the owner use a freshly issued code after an attacker burned the previous one', async () => {
      let stored: { id: string; hash: string } | null = {
        id: 'token-1',
        hash: 'h:old-code',
      };
      tokenService.hashToken.mockImplementation((t) => `h:${t}`);
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
      authRepository.findTokensByUserEmail.mockImplementation(() =>
        Promise.resolve(
          stored
            ? [makeToken({ id: stored.id, type: TokenType.PASSWORD_RESET })]
            : [],
        ),
      );
      authRepository.findTokenByHashedToken.mockImplementation((hash) =>
        Promise.resolve(
          stored && stored.hash === hash
            ? { ...mockResetToken, id: stored.id }
            : null,
        ),
      );
      authRepository.deleteToken.mockImplementation((id) => {
        if (stored?.id === id) stored = null;
        return Promise.resolve();
      });
      authRepository.deleteUserTokensByType.mockImplementation(() => {
        stored = null;
        return Promise.resolve();
      });
      authRepository.createToken.mockImplementation((data) => {
        stored = { id: 'token-2', hash: data.token };
        return Promise.resolve(makeToken({ id: 'token-2' }));
      });
      (generateResetCode as jest.Mock).mockReturnValueOnce({
        token: 'new-code',
        expiresAt: new Date(Date.now() + 86400000),
      });
      for (let i = 0; i < 10; i++) {
        await expect(validate(`g${i}`, 'test@example.com')).rejects.toThrow(
          NotFoundException,
        );
      }
      expect(stored).toBeNull();

      await service.requestPasswordReset({ email: 'test@example.com' });

      expect(stored).toEqual({ id: 'token-2', hash: 'h:new-code' });
      await expect(validate('new-code', 'test@example.com')).resolves.toEqual({
        message: 'Valid reset token',
      });
    });

    it('deletes the active token when the pre-lookup counter is already past the cap', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
      fakeRedis.seed('password-reset:token-failures:token-1', 5);

      await expect(
        validate('raw-reset-token', 'test@example.com'),
      ).rejects.toThrow(new NotFoundException('Invalid reset token'));

      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });

    it('does not clear the counter when validation fails', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(validate('x', 'test@example.com')).rejects.toThrow(
        NotFoundException,
      );
      expect(counterKeys()).toHaveLength(1);
    });

    it('clears the counter after a successful validation', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(validate('x', 'test@example.com')).rejects.toThrow(
        NotFoundException,
      );
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      await validate('raw-reset-token', 'test@example.com');

      expect(counterKeys()).toHaveLength(0);
    });

    it('treats an expired token with a wrong email as unknown and keeps the token', async () => {
      authRepository.findUserByEmail.mockResolvedValue(null);
      authRepository.findTokenByHashedToken.mockResolvedValue({
        ...mockResetToken,
        expiresAt: new Date('2020-01-01'),
      });

      await expect(
        validate('raw-reset-token', 'other@example.com'),
      ).rejects.toThrow(NotFoundException);
      expect(authRepository.deleteToken).not.toHaveBeenCalled();
    });

    it('charges the token once when the owner email differs only in casing', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue({
        ...mockResetToken,
        expiresAt: new Date('2020-01-01'),
        user: { ...mockUser, email: 'Test@Example.com' },
      });

      await expect(
        validate('raw-reset-token', 'test@example.com'),
      ).rejects.toThrow(UnauthorizedException);
      expect(fakeRedis.counts()).toEqual([1]);
    });

    it('sets a TTL on the counter in the same atomic operation as the first failure', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(validate('x', 'test@example.com')).rejects.toThrow(
        NotFoundException,
      );
      expect([...fakeRedis.ttls.values()]).toEqual([3_600_000]);
    });

    it('gives a counter with no TTL an expiry on the next attempt', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(null);
      await expect(validate('a', 'test@example.com')).rejects.toThrow(
        NotFoundException,
      );
      fakeRedis.seed('password-reset:token-failures:token-1', 1, null);

      await expect(validate('b', 'test@example.com')).rejects.toThrow(
        NotFoundException,
      );

      expect([...fakeRedis.ttls.values()]).toEqual([3_600_000]);
    });

    it('withdraws the charges already taken when charging a later token fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      authRepository.findTokensByUserEmail.mockResolvedValue([
        makeToken({ id: 'token-1', type: TokenType.PASSWORD_RESET }),
        makeToken({ id: 'token-2', type: TokenType.PASSWORD_RESET }),
      ]);
      fakeRedis.seed('password-reset:token-failures:token-1', 4);
      const evalOnce = fakeRedis.eval;
      jest
        .spyOn(fakeRedis, 'eval')
        .mockImplementationOnce(evalOnce)
        .mockImplementationOnce(() =>
          Promise.reject(new Error('Connection is closed.')),
        );

      await expect(
        validate('raw-reset-token', 'test@example.com'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(fakeRedis.failures('password-reset:token-failures:token-1')).toBe(
        4,
      );
      expect(authRepository.findTokenByHashedToken).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it('lets concurrent guesses be evaluated at most 5 times', async () => {
      stubActiveToken();
      authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          validate('raw-reset-token', 'test@example.com'),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
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

      const stubActiveToken = () => {
        authRepository.findTokensByUserEmail.mockResolvedValue([
          makeToken({ type: TokenType.PASSWORD_RESET }),
        ]);
      };

      it('invalidates the token after 5 wrong guesses and never resets with the correct code afterwards', async () => {
        stubActiveToken();
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        for (let i = 0; i < 5; i++) {
          await expect(attempt(`guess-${i}`)).rejects.toThrow(
            NotFoundException,
          );
        }
        expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');

        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        await expect(attempt('raw-reset-token')).rejects.toThrow(
          new NotFoundException('Invalid reset token'),
        );
        expect(authRepository.updateUser).not.toHaveBeenCalled();
      });

      it('charges a mismatched-email guess to the token owner', async () => {
        authRepository.findUserByEmail.mockResolvedValue(null);
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        for (let i = 0; i < 5; i++) {
          await expect(
            attempt('raw-reset-token', `rotating-${i}@example.com`),
          ).rejects.toThrow(NotFoundException);
        }
        await new Promise((resolve) => setImmediate(resolve));

        expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
        expect(authRepository.updateUser).not.toHaveBeenCalled();
      });

      it('answers a mismatched email without waiting on the token owner charge, which gives up after the deadline', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
        authRepository.findUserByEmail.mockResolvedValue(null);
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        fakeRedis.chargeReply = 'slow';

        await expect(
          attempt('raw-reset-token', 'other@example.com'),
        ).rejects.toThrow(new NotFoundException('Invalid reset token'));
        expect(errorSpy).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(2000);

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to charge reset token owner (HealthCheckTimeoutError)',
        );
        errorSpy.mockRestore();
        jest.useRealTimers();
      });

      it('logs a failed token owner charge without the email or token', async () => {
        authRepository.findUserByEmail.mockResolvedValue(null);
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.deleteToken.mockRejectedValue(
          Object.assign(new Error(`db down for ${mockUser.email}`), {
            code: 'P1001',
          }),
        );
        fakeRedis.seed('password-reset:token-failures:token-1', 4);
        const errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);

        await expect(
          attempt('raw-reset-token', 'other@example.com'),
        ).rejects.toThrow(NotFoundException);
        await new Promise((resolve) => setImmediate(resolve));

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to charge reset token owner (P1001)',
        );
        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).not.toContain(mockUser.email);
        expect(logged).not.toContain('raw-reset-token');
        errorSpy.mockRestore();
      });

      it('lets concurrent guesses be evaluated at most 5 times', async () => {
        stubActiveToken();
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.updateUser.mockResolvedValue(makeUser());

        const results = await Promise.allSettled(
          Array.from({ length: 20 }, () => attempt('raw-reset-token')),
        );

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      });

      it('clears the counter after a successful reset', async () => {
        stubActiveToken();
        authRepository.findTokenByHashedToken.mockResolvedValue(null);
        for (let i = 0; i < 4; i++) {
          await expect(attempt(`guess-${i}`)).rejects.toThrow(
            NotFoundException,
          );
        }
        authRepository.findTokenByHashedToken.mockResolvedValue(mockResetToken);
        authRepository.updateUser.mockResolvedValue(makeUser());

        await attempt('raw-reset-token');

        expect(fakeRedis.hashes.size).toBe(0);
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
    type CounterMode = 'up' | 'down' | 'error' | 'slow' | 'late' | 'offline';
    type ClearMode = 'up' | 'down' | 'slow';
    type DbMode =
      'ok' | 'lookup-fails' | 'write-fails' | 'sessions-fail' | 'raced';
    type World = { counter: CounterMode; clear: ClearMode; db: DbMode };

    const HEALTHY: World = { counter: 'up', clear: 'up', db: 'ok' };
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
    const failuresKey = (code: string) =>
      `password-reset:token-failures:id-${code}`;

    let tokens: Map<string, TokenWithUser>;
    let repoCalls: string[];
    let committed: string[];
    let world: World;

    const seedToken = (code: string, owner: typeof ownerA) =>
      tokens.set(code, {
        ...makeToken({
          id: `id-${code}`,
          userId: owner.id,
          token: `h:${code}`,
          type: TokenType.PASSWORD_RESET,
          expiresAt: new Date(
            NOW +
              (code.endsWith('old') ? -3600_000 : 0) +
              (code.endsWith('live') ? 3600_000 : 0),
          ),
        }),
        user: owner,
      });

    const ownCode = (presented: Presented) =>
      presented === 'own-expired'
        ? 'a-old'
        : presented === 'own-at-expiry'
          ? 'a-now'
          : 'a-live';
    const foreignCode = (presented: Presented) =>
      presented === 'foreign-expired' ? 'b-old' : 'b-live';

    const seedWorld = (presented: Presented) => {
      tokens = new Map();
      committed = [];
      seedToken(ownCode(presented), ownerA);
      seedToken(presented === 'foreign-expired' ? 'b-old' : 'b-live', ownerB);
    };
    const flush = async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    const applyWorld = (w: World) => {
      world = w;
      fakeRedis.link =
        w.counter === 'late' || w.counter === 'offline' ? w.counter : 'up';
      fakeRedis.chargeReply = (
        {
          up: 'ok',
          down: 'down',
          error: 'garbage',
          slow: 'slow',
          late: 'ok',
          offline: 'ok',
        } as const
      )[w.counter];
      fakeRedis.writeReply = (
        { up: 'ok', down: 'down', slow: 'slow' } as const
      )[w.clear];
    };

    beforeEach(() => {
      tokens = new Map();
      repoCalls = [];
      committed = [];
      world = HEALTHY;
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
      const dbDown = () => Promise.reject(new Error('db unavailable'));
      (bcrypt.hash as jest.Mock).mockImplementation(
        record('bcrypt.hash', () => Promise.resolve('hashed-password')),
      );
      tokenService.hashToken.mockImplementation((code: string) => `h:${code}`);
      authRepository.findUserByEmail.mockImplementation(
        record('findUserByEmail', (email: string) =>
          Promise.resolve(users.find((u) => u.email === email) ?? null),
        ),
      );
      authRepository.findTokensByUserEmail.mockImplementation(
        record('findTokensByUserEmail', (email: string) =>
          Promise.resolve(
            [...tokens.values()].filter(
              (t) => t.user.email.toLowerCase() === email.trim().toLowerCase(),
            ),
          ),
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
          removeWhere((t) => t.id === id);
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
      foreignPrior = 0,
    ) => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] });
      try {
        applyWorld(w);
        seedWorld(presented);
        fakeRedis.reset();
        fakeRedis.seed(failuresKey(ownCode(presented)), priorFailures[state]);
        if (foreignPrior > 0) {
          fakeRedis.seed(failuresKey(foreignCode(presented)), foreignPrior);
        }
        repoCalls = [];
        let preResponseCalls: string[] = [];
        const timed =
          ['slow', 'late', 'offline'].includes(w.counter) || w.clear === 'slow';
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
        if (timed) {
          await flush();
          await jest.advanceTimersByTimeAsync(5000);
        }
        const outcome = await settled;
        if (w.counter === 'offline') fakeRedis.reconnect();
        await flush();
        if (timed) await jest.advanceTimersByTimeAsync(5000);
        await flush();
        const after = {
          ...outcome,
          preResponseCalls,
          applied: [...fakeRedis.applied],
          remaining: [...tokens.keys()].sort(),
          ownFailures: fakeRedis.failures(failuresKey(ownCode(presented))),
          foreignFailures: fakeRedis.failures(
            failuresKey(foreignCode(presented)),
          ),
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
    const UNAVAILABLE = new ServiceUnavailableException(
      'Password reset is temporarily unavailable. Try again later.',
    ).getResponse();

    type Expected = {
      status: number;
      body: unknown;
      remaining: string[];
      ownFailures: number | undefined;
      foreignFailures: number | undefined;
      committed: string[];
      followUp: number;
    };

    const outcomeFor = (
      entry: Entry,
      emailOwnsA: boolean,
      presented: Presented,
      state: CapState,
      w: World,
    ): Omit<Expected, 'followUp'> => {
      const own = ownCode(presented);
      const foreign = foreignCode(presented);
      const all = [own, foreign].sort();
      const prior = priorFailures[state];
      const overCap = prior >= 5;
      const charged = emailOwnsA && !overCap ? prior + 1 : prior;
      const isForeign = presented.startsWith('foreign');
      const backgroundLands =
        w.counter === 'up' || w.counter === 'late' || w.counter === 'offline';
      const foreignFailures =
        isForeign && w.db !== 'lookup-fails' && backgroundLands ? 1 : undefined;
      const presentedCode =
        presented === 'unknown' ? undefined : isForeign ? foreign : own;
      const raced = (codes: string[]) =>
        w.db === 'raced' ? codes.filter((c) => c !== presentedCode) : codes;
      const result = (
        status: number,
        body: unknown,
        remaining: string[],
        ownFailures: number | undefined,
        committed: string[] = [],
      ) => ({
        status,
        body,
        remaining,
        ownFailures,
        foreignFailures,
        committed,
      });
      const refunded = w.clear === 'up' ? prior : charged;

      if (emailOwnsA && w.counter !== 'up') {
        return {
          ...result(503, UNAVAILABLE, all, prior),
          foreignFailures: undefined,
        };
      }
      if (w.db === 'lookup-fails') {
        return result(
          500,
          'db unavailable',
          all,
          emailOwnsA ? refunded : prior,
        );
      }
      if (!emailOwnsA) {
        return result(404, NOT_FOUND, raced(all), prior);
      }
      if (overCap) return result(404, NOT_FOUND, raced([foreign]), prior);
      if (presented === 'own-live') {
        if (entry === 'validate') {
          return result(
            200,
            { message: 'Valid reset token' },
            raced(all),
            w.clear === 'up' ? undefined : charged,
          );
        }
        if (w.db === 'raced') return result(404, NOT_FOUND, [foreign], charged);
        if (w.db === 'write-fails' || w.db === 'sessions-fail') {
          return result(500, 'db unavailable', all, refunded);
        }
        return result(
          200,
          { message: 'Password has been reset successfully' },
          [foreign],
          w.clear === 'up' ? undefined : charged,
          ['updateUser', 'deleteAllUserSessions'],
        );
      }
      if (presented === 'own-expired' || presented === 'own-at-expiry') {
        return result(401, EXPIRED, [foreign], charged);
      }
      return result(
        404,
        NOT_FOUND,
        raced(charged >= 5 ? [foreign] : all),
        charged,
      );
    };

    const expectedFor = (
      entry: Entry,
      emailOwnsA: boolean,
      presented: Presented,
      state: CapState,
      w: World,
    ): Expected => {
      const outcome = outcomeFor(entry, emailOwnsA, presented, state, w);
      const followUp =
        outcome.remaining.includes('a-live') && (outcome.ownFailures ?? 0) < 5
          ? 200
          : 404;
      return { ...outcome, followUp };
    };

    const emails = [
      { label: 'owner email', email: 'a@example.com', ownsA: true },
      {
        label: 'owner email in other casing',
        email: 'A@Example.com',
        ownsA: true,
      },
      {
        label: 'email with no account',
        email: 'ghost@example.com',
        ownsA: false,
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
    const entries: Entry[] = ['validate', 'reset'];
    const states: CapState[] = ['first', 'last', 'over'];
    const dbModes: DbMode[] = [
      'ok',
      'lookup-fails',
      'write-fails',
      'sessions-fail',
      'raced',
    ];
    const counterModes: CounterMode[] = [
      'up',
      'down',
      'error',
      'slow',
      'late',
      'offline',
    ];
    const worlds: World[] = [
      ...counterModes.flatMap((counter) =>
        dbModes.map((db): World => ({ counter, clear: 'up', db })),
      ),
      ...(['down', 'slow'] as ClearMode[]).flatMap((clear) =>
        dbModes.map((db): World => ({ counter: 'up', clear, db })),
      ),
    ];
    const describeWorld = ({ counter, clear, db }: World) =>
      `redis counter ${counter}, redis clear ${clear}, db ${db}`;
    const rows = worlds.flatMap((w) =>
      entries.flatMap((entry) =>
        emails.flatMap(({ label, email, ownsA }) =>
          states.flatMap((state) =>
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
                expected: expectedFor(entry, ownsA, presented, state, w),
              })),
          ),
        ),
      ),
    );

    it.each(rows)(
      '$worldLabel / $entry: $label, $state attempt, $presented code',
      async ({ entry, email, presented, state, world: w, expected }) => {
        const result = await run(entry, email, presented, state, w);

        expect({
          status: result.status,
          body: result.body,
          remaining: result.remaining,
          ownFailures: result.ownFailures,
          foreignFailures: result.foreignFailures,
          committed: result.committed,
          followUp: result.followUp,
        }).toEqual(expected);
      },
    );

    it('sends no counter command while the client is reconnecting, so nothing replays on reconnect', async () => {
      const result = await run('reset', 'a@example.com', 'own-live', 'last', {
        ...HEALTHY,
        counter: 'offline',
      });

      expect(result.status).toBe(503);
      expect(result.applied).toEqual([]);
    });

    it('withdraws a counter command that lands after its 503, in send order', async () => {
      const result = await run('reset', 'a@example.com', 'own-live', 'last', {
        ...HEALTHY,
        counter: 'late',
      });

      expect(result.status).toBe(503);
      expect(result.applied).toEqual(['eval', 'hdel']);
      expect(result.ownFailures).toBe(4);
    });

    it.each(
      entries.flatMap((entry) =>
        emails.flatMap(({ label, email }) =>
          states.map((state) => ({ entry, label, email, state })),
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
        'findTokensByUserEmail',
        'findTokenByHashedToken',
        'bcrypt.hash',
        'transaction',
        'tx.consumeToken',
        'tx.updateUser',
        'tx.deleteAllUserSessions',
      ]);
    });

    it('never logs an email or a code on any path', async () => {
      const spies = (['log', 'error', 'warn', 'debug', 'verbose'] as const).map(
        (level) =>
          jest
            .spyOn(Logger.prototype, level)
            .mockImplementation(() => undefined),
      );
      const deleteToken = authRepository.deleteToken.getMockImplementation()!;
      authRepository.deleteToken.mockImplementation((id: string) =>
        id.startsWith('id-b')
          ? Promise.reject(
              new Error('db unavailable for b@example.com, code b-live'),
            )
          : deleteToken(id),
      );

      for (const { entry, email, presented, state, world: w } of rows) {
        await run(entry, email, presented, state, w, 4);
      }

      const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
      for (const secret of [
        'a@example.com',
        'A@Example.com',
        'b@example.com',
        'ghost@example.com',
        ...Object.values(codeFor),
      ]) {
        expect(logged).not.toContain(secret);
      }
      expect(logged).toContain('Failed to charge reset token owner (Error)');
      expect(logged).toContain('Failed to clear reset attempts');
      spies.forEach((spy) => spy.mockRestore());
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
