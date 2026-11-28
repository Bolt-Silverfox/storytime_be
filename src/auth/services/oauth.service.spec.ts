import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import appleSigninAuth from 'apple-signin-auth';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import {
  AUTH_REPOSITORY,
  IAuthRepository,
  UserWithProfileAndAvatar,
} from '../repositories';
import { makeUser } from '@/shared/testing/prisma-fixtures';
import { NotificationPreferenceService } from '@/notification/services/notification-preference.service';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

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
  afterEach(() => {
    (appleSigninAuth.verifyIdToken as jest.Mock).mockReset();
  });

  let service: OAuthService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let googleClient: { verifyIdToken: jest.Mock };

  const mockUser: UserWithProfileAndAvatar = {
    ...makeUser({
      passwordHash: 'hashed_password',
      role: Role.parent,
      googleId: 'google-123',
    }),
    profile: null,
    avatar: null,
  };

  beforeEach(async () => {
    const mockAuthRepository = {
      findUserByGoogleId: jest.fn(),
      findUserByAppleId: jest.fn(),
      findUserByEmail: jest.fn(),
      findUserByEmailIgnoringCase: jest.fn(),
      updateUser: jest.fn(),
      updateUserWithRelations: jest.fn(),
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

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          GOOGLE_CLIENT_ID: 'test-google-client-id',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: TokenService, useValue: mockTokenService },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: NotificationPreferenceService,
          useValue: mockNotificationPreferenceService,
        },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
    authRepository = module.get(AUTH_REPOSITORY);
    tokenService = module.get(TokenService);
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

      authRepository.findUserByGoogleId.mockResolvedValue(mockUser);
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

    it('looks up the account by the provider email as sent (trimmed) and creates it lowercased', async () => {
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-new',
          email: ' New.User@Example.COM ',
          email_verified: true,
        }),
      });
      authRepository.findUserByGoogleId.mockResolvedValue(null);
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(null);
      authRepository.createUser.mockResolvedValue(mockUser);
      authRepository.countKidsByParentId.mockResolvedValue(0);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      await service.loginWithGoogleIdToken('valid-token');

      expect(authRepository.findUserByEmailIgnoringCase).toHaveBeenCalledWith(
        'New.User@Example.COM',
      );
      expect(authRepository.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new.user@example.com' }),
      );
    });

    it.each([
      { label: 'false', claim: false },
      { label: 'missing', claim: undefined },
    ])(
      'refuses to link an existing account when Google reports the email as $label',
      async ({ claim }) => {
        googleClient.verifyIdToken.mockResolvedValue({
          getPayload: () => ({
            sub: 'google-attacker',
            email: 'Test@Example.com',
            email_verified: claim,
          }),
        });
        authRepository.findUserByGoogleId.mockResolvedValue(null);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);

        await expect(
          service.loginWithGoogleIdToken('valid-token'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(authRepository.updateUserWithRelations).not.toHaveBeenCalled();
        expect(authRepository.createUser).not.toHaveBeenCalled();
        expect(tokenService.createTokenPair).not.toHaveBeenCalled();
      },
    );

    it('links an existing account when Google reports the email as verified', async () => {
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-owner',
          email: 'test@example.com',
          email_verified: true,
        }),
      });
      authRepository.findUserByGoogleId.mockResolvedValue(null);
      authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);
      authRepository.updateUserWithRelations.mockResolvedValue(mockUser);
      authRepository.countKidsByParentId.mockResolvedValue(0);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      await service.loginWithGoogleIdToken('valid-token');

      expect(authRepository.updateUserWithRelations).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ googleId: 'google-owner' }),
      );
    });
  });

  describe('accounts stored with mixed-case emails', () => {
    it('links the existing mixed-case account instead of creating a lowercase duplicate', async () => {
      const stored = { ...mockUser, email: 'Mixed.Case@Example.com' };
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-owner',
          email: 'mixed.case@example.com',
          email_verified: true,
        }),
      });
      authRepository.findUserByGoogleId.mockResolvedValue(null);
      authRepository.findUserByEmail.mockImplementation((email: string) =>
        Promise.resolve(email === stored.email ? stored : null),
      );
      authRepository.findUserByEmailIgnoringCase.mockImplementation(
        (email: string) =>
          Promise.resolve(
            email.toLowerCase() === stored.email.toLowerCase() ? stored : null,
          ),
      );
      authRepository.updateUserWithRelations.mockResolvedValue(stored);
      authRepository.countKidsByParentId.mockResolvedValue(0);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      await service.loginWithGoogleIdToken('valid-token');

      expect(authRepository.updateUserWithRelations).toHaveBeenCalledWith(
        stored.id,
        expect.objectContaining({ googleId: 'google-owner' }),
      );
      expect(authRepository.createUser).not.toHaveBeenCalled();
    });
  });

  describe('loginWithAppleIdToken', () => {
    it.each([
      { label: "'false'", claim: 'false' },
      { label: 'missing', claim: undefined },
    ])(
      'refuses to link an existing account when Apple reports the email as $label',
      async ({ claim }) => {
        (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
          sub: 'apple-attacker',
          email: 'test@example.com',
          email_verified: claim,
        });
        authRepository.findUserByAppleId.mockResolvedValue(null);
        authRepository.findUserByEmailIgnoringCase.mockResolvedValue(mockUser);

        await expect(
          service.loginWithAppleIdToken('valid-token'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(authRepository.updateUserWithRelations).not.toHaveBeenCalled();
        expect(tokenService.createTokenPair).not.toHaveBeenCalled();
      },
    );
  });
});
