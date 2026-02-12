import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
import { NotificationPreferenceService } from '@/notification/services/notification-preference.service';
import { OAuth2Client } from 'google-auth-library';
import appleSigninAuth from 'apple-signin-auth';

// Mock google-auth-library
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

// Mock apple-signin-auth
jest.mock('apple-signin-auth', () => ({
  __esModule: true,
  default: {
    verifyIdToken: jest.fn(),
  },
}));

describe('OAuthService', () => {
  let service: OAuthService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let passwordService: jest.Mocked<PasswordService>;
  let googleClient: { verifyIdToken: jest.Mock };

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed_password',
    isEmailVerified: true,
    role: 'parent',
    googleId: 'google-123',
    appleId: null,
    avatarId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockAuthRepository = {
      findUserByGoogleId: jest.fn(),
      findUserByAppleId: jest.fn(),
      findUserByEmail: jest.fn(),
      updateUser: jest.fn(),
      createUser: jest.fn(),
      findAvatarByUrl: jest.fn(),
      createAvatar: jest.fn(),
      countKidsByParentId: jest.fn(),
    };

    const mockTokenService = {
      createTokenPair: jest.fn(),
    };

    const mockPasswordService = {
      hashPassword: jest.fn(),
    };

    const mockNotificationPreferenceService = {
      seedDefaultPreferences: jest.fn(),
    };

    googleClient = { verifyIdToken: jest.fn() };
    (OAuth2Client as unknown as jest.Mock).mockImplementation(
      () => googleClient,
    );

    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: TokenService, useValue: mockTokenService },
        { provide: PasswordService, useValue: mockPasswordService },
        {
          provide: NotificationPreferenceService,
          useValue: mockNotificationPreferenceService,
        },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
    authRepository = module.get(AUTH_REPOSITORY);
    tokenService = module.get(TokenService);
    passwordService = module.get(PasswordService);
  });

  describe('loginWithGoogleIdToken', () => {
    it('should throw BadRequestException when id_token is missing', async () => {
      await expect(service.loginWithGoogleIdToken('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should login existing user by googleId', async () => {
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-123',
          email: 'test@example.com',
          email_verified: true,
        }),
      });

      authRepository.findUserByGoogleId.mockResolvedValue(mockUser as any);
      authRepository.countKidsByParentId.mockResolvedValue(2);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      const result = await service.loginWithGoogleIdToken('valid-token');

      expect(result).toBeDefined();
      expect(result.jwt).toBe('jwt-token');
      expect(authRepository.findUserByGoogleId).toHaveBeenCalledWith(
        'google-123',
      );
    });
  });
});
