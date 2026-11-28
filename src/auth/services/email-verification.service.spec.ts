import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';
import { TokenService } from './token.service';
import {
  AUTH_REPOSITORY,
  IAuthRepository,
  IAuthRepositoryTransaction,
  TokenWithUser,
} from '../repositories';
import { makeToken, makeUser } from '@/shared/testing/prisma-fixtures';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TokenType } from '../dto/auth.dto';
import {
  ResourceNotFoundException,
  InvalidTokenException,
  TokenExpiredException,
} from '@/shared/exceptions';
import { AppEvents } from '@/shared/events';
import { OnboardingStatus, Role } from '@prisma/client';

jest.mock('@/shared/utils/generate-token', () => ({
  generateToken: jest.fn().mockReturnValue({
    token: 'raw-verification-token',
    expiresAt: new Date('2026-03-01T00:00:00Z'),
  }),
}));

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let liveTokens: Map<string, Date>;
  let verifiedUsers: string[];
  let verifyTx: jest.Mocked<IAuthRepositoryTransaction>;

  const mockUser = makeUser({
    passwordHash: 'hashed_password',
    isEmailVerified: false,
    role: Role.parent,
    onboardingStatus: OnboardingStatus.account_created,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  const mockTokenRecord: TokenWithUser = {
    ...makeToken({
      token: 'hashed-token',
      type: TokenType.VERIFICATION,
      expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
      createdAt: new Date(),
    }),
    user: mockUser,
  };

  beforeEach(async () => {
    const mockAuthRepository: Partial<jest.Mocked<IAuthRepository>> = {
      findUserByEmail: jest.fn(),
      deleteUserTokensByType: jest.fn(),
      createToken: jest.fn(),
      findTokenByHashedToken: jest.fn(),
      deleteToken: jest.fn(),
      updateUser: jest.fn(),
      transaction: jest.fn(),
    };
    liveTokens = new Map([[mockTokenRecord.id, mockTokenRecord.expiresAt]]);
    verifiedUsers = [];
    verifyTx = {
      consumeToken: jest.fn(async (id: string) => {
        await new Promise((resolve) => setImmediate(resolve));
        const expiresAt = liveTokens.get(id);
        if (!expiresAt || expiresAt <= new Date()) return false;
        liveTokens.delete(id);
        return true;
      }),
      markEmailVerified: jest.fn((userId: string) => {
        verifiedUsers.push(userId);
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<IAuthRepositoryTransaction>;
    mockAuthRepository.transaction!.mockImplementation(async (fn) => {
      const snapshot = new Map(liveTokens);
      const verifiedBefore = [...verifiedUsers];
      try {
        return await fn(verifyTx);
      } catch (error) {
        liveTokens = snapshot;
        verifiedUsers = verifiedBefore;
        throw error;
      }
    });

    const mockTokenService: Partial<jest.Mocked<TokenService>> = {
      hashToken: jest.fn().mockReturnValue('hashed-token'),
    };

    const mockEventEmitter: Partial<jest.Mocked<EventEmitter2>> = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: TokenService, useValue: mockTokenService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<EmailVerificationService>(EmailVerificationService);
    authRepository = module.get(AUTH_REPOSITORY);
    tokenService = module.get(TokenService);
    eventEmitter = module.get(EventEmitter2);
  });

  describe('sendEmailVerification', () => {
    it('should send verification email successfully', async () => {
      // Arrange
      authRepository.findUserByEmail.mockResolvedValue(mockUser);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue(makeToken());

      // Act
      const result = await service.sendEmailVerification('test@example.com');

      // Assert
      expect(result).toEqual({ message: 'Verification email sent' });
      expect(authRepository.findUserByEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(authRepository.deleteUserTokensByType).toHaveBeenCalledWith(
        'user-1',
        TokenType.VERIFICATION,
      );
      expect(tokenService.hashToken).toHaveBeenCalledWith(
        'raw-verification-token',
      );
      expect(authRepository.createToken).toHaveBeenCalledWith({
        userId: 'user-1',
        token: 'hashed-token',
        expiresAt: expect.any(Date),
        type: TokenType.VERIFICATION,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'email.verification_requested',
        {
          userId: 'user-1',
          email: 'test@example.com',
          token: 'raw-verification-token',
        },
      );
    });

    it('should throw ResourceNotFoundException when user is not found', async () => {
      // Arrange
      authRepository.findUserByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.sendEmailVerification('nonexistent@example.com'),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should delete existing verification tokens before creating new one', async () => {
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
      await service.sendEmailVerification('test@example.com');

      // Assert
      expect(callOrder).toEqual(['deleteTokens', 'createToken']);
    });
  });

  describe('verifyEmail', () => {
    it('should verify email successfully with valid token', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(mockTokenRecord);
      authRepository.updateUser.mockResolvedValue(makeUser());
      authRepository.deleteToken.mockResolvedValue(undefined);

      // Act
      const result = await service.verifyEmail('raw-verification-token');

      // Assert
      expect(result).toEqual({ message: 'Email verified successfully' });
      expect(tokenService.hashToken).toHaveBeenCalledWith(
        'raw-verification-token',
      );
      expect(authRepository.findTokenByHashedToken).toHaveBeenCalledWith(
        'hashed-token',
        TokenType.VERIFICATION,
      );
      expect(verifiedUsers).toEqual(['user-1']);
      expect(liveTokens.has('token-1')).toBe(false);
      expect(authRepository.updateUser).not.toHaveBeenCalled();
    });

    it('claims the token before marking the email verified, in one transaction', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockTokenRecord);

      await service.verifyEmail('raw-verification-token');

      expect(authRepository.transaction).toHaveBeenCalledTimes(1);
      expect(verifyTx.consumeToken.mock.invocationCallOrder[0]).toBeLessThan(
        verifyTx.markEmailVerified.mock.invocationCallOrder[0],
      );
    });

    it('verifies once and emits once when the same token is presented concurrently', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockTokenRecord);

      const results = await Promise.allSettled([
        service.verifyEmail('raw-verification-token'),
        service.verifyEmail('raw-verification-token'),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )!;
      expect(rejected.reason).toBeInstanceOf(InvalidTokenException);
      expect(verifiedUsers).toEqual(['user-1']);
      expect(
        eventEmitter.emit.mock.calls.filter(
          ([event]) => event === AppEvents.USER_EMAIL_VERIFIED,
        ),
      ).toHaveLength(1);
    });

    it('keeps the token and emits nothing when marking the email verified fails', async () => {
      authRepository.findTokenByHashedToken.mockResolvedValue(mockTokenRecord);
      verifyTx.markEmailVerified.mockRejectedValueOnce(
        new Error('db unavailable'),
      );

      await expect(
        service.verifyEmail('raw-verification-token'),
      ).rejects.toThrow('db unavailable');

      expect(liveTokens.has('token-1')).toBe(true);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      await expect(
        service.verifyEmail('raw-verification-token'),
      ).resolves.toEqual({ message: 'Email verified successfully' });
    });

    it('rejects a token at its exact expiry instant', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        const now = new Date('2026-06-01T00:00:00Z');
        jest.setSystemTime(now);
        authRepository.findTokenByHashedToken.mockResolvedValue({
          ...mockTokenRecord,
          expiresAt: now,
        });
        liveTokens.set(mockTokenRecord.id, now);

        await expect(
          service.verifyEmail('raw-verification-token'),
        ).rejects.toThrow(TokenExpiredException);
        expect(verifiedUsers).toEqual([]);
        expect(eventEmitter.emit).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should emit USER_EMAIL_VERIFIED event on success', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(mockTokenRecord);
      authRepository.updateUser.mockResolvedValue(makeUser());
      authRepository.deleteToken.mockResolvedValue(undefined);

      // Act
      await service.verifyEmail('raw-verification-token');

      // Assert
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        AppEvents.USER_EMAIL_VERIFIED,
        expect.objectContaining({
          userId: 'user-1',
          email: 'test@example.com',
          verifiedAt: expect.any(Date),
        }),
      );
    });

    it('should throw InvalidTokenException when token is not found', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(null);

      // Act & Assert
      await expect(service.verifyEmail('invalid-token')).rejects.toThrow(
        InvalidTokenException,
      );
    });

    it('should throw TokenExpiredException when token has expired', async () => {
      // Arrange
      const expiredToken = {
        ...mockTokenRecord,
        expiresAt: new Date('2020-01-01'),
      };
      authRepository.findTokenByHashedToken.mockResolvedValue(expiredToken);
      authRepository.deleteToken.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        service.verifyEmail('expired-verification-token'),
      ).rejects.toThrow(TokenExpiredException);
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });

    it('should delete expired token before throwing TokenExpiredException', async () => {
      // Arrange
      const expiredToken = {
        ...mockTokenRecord,
        expiresAt: new Date('2020-01-01'),
      };
      authRepository.findTokenByHashedToken.mockResolvedValue(expiredToken);
      authRepository.deleteToken.mockResolvedValue(undefined);

      // Act & Assert
      await expect(service.verifyEmail('expired-token')).rejects.toThrow(
        TokenExpiredException,
      );
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });

    it('still answers TokenExpiredException when deleting the expired token fails, logging the failure by class only', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      authRepository.findTokenByHashedToken.mockResolvedValue({
        ...mockTokenRecord,
        expiresAt: new Date('2020-01-01'),
      });
      authRepository.deleteToken.mockRejectedValue(
        new Error(`db down for ${mockTokenRecord.user.email}`),
      );

      await expect(service.verifyEmail('expired-token')).rejects.toThrow(
        TokenExpiredException,
      );

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to delete expired verification token (Error)',
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        mockTokenRecord.user.email,
      );
      errorSpy.mockRestore();
    });
  });
});
