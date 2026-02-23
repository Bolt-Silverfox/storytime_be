import { Test, TestingModule } from '@nestjs/testing';
import { EmailVerificationService } from './email-verification.service';
import { TokenService } from './token.service';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
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

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed_password',
    isEmailVerified: false,
    role: Role.parent,
    onboardingStatus: OnboardingStatus.account_created,
    googleId: null,
    appleId: null,
    avatarId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockTokenRecord = {
    id: 'token-1',
    userId: 'user-1',
    token: 'hashed-token',
    type: TokenType.VERIFICATION,
    expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
    createdAt: new Date(),
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
    };

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
      authRepository.findUserByEmail.mockResolvedValue(mockUser as any);
      authRepository.deleteUserTokensByType.mockResolvedValue(undefined);
      authRepository.createToken.mockResolvedValue({} as any);

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
      authRepository.findUserByEmail.mockResolvedValue(mockUser as any);
      authRepository.deleteUserTokensByType.mockImplementation(async () => {
        callOrder.push('deleteTokens');
      });
      authRepository.createToken.mockImplementation(async () => {
        callOrder.push('createToken');
        return {} as any;
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
      authRepository.findTokenByHashedToken.mockResolvedValue(
        mockTokenRecord as any,
      );
      authRepository.updateUser.mockResolvedValue({} as any);
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
      expect(authRepository.updateUser).toHaveBeenCalledWith('user-1', {
        isEmailVerified: true,
        onboardingStatus: 'email_verified',
      });
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });

    it('should emit USER_EMAIL_VERIFIED event on success', async () => {
      // Arrange
      authRepository.findTokenByHashedToken.mockResolvedValue(
        mockTokenRecord as any,
      );
      authRepository.updateUser.mockResolvedValue({} as any);
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
      authRepository.findTokenByHashedToken.mockResolvedValue(
        expiredToken as any,
      );
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
      authRepository.findTokenByHashedToken.mockResolvedValue(
        expiredToken as any,
      );
      authRepository.deleteToken.mockResolvedValue(undefined);

      // Act & Assert
      await expect(service.verifyEmail('expired-token')).rejects.toThrow(
        TokenExpiredException,
      );
      expect(authRepository.deleteToken).toHaveBeenCalledWith('token-1');
    });
  });
});
