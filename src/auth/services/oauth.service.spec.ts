import { Test, TestingModule } from '@nestjs/testing';
import { renderLogCalls } from '@/shared/testing/render-log-calls';
import { OAuthService } from './oauth.service';
import { BadRequestException, Logger } from '@nestjs/common';
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
  });
  describe('verification failure logging', () => {
    const idToken = 'eyJsentinel.header.signature';
    const email = 'kid.parent@example.com';
    let logged: unknown[][];

    beforeEach(() => {
      logged = [];
      for (const level of ['log', 'error', 'warn', 'debug'] as const) {
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            logged.push(args);
          });
      }
    });

    afterEach(() => jest.restoreAllMocks());

    it('logs neither the Google id_token nor its payload', async () => {
      googleClient.verifyIdToken.mockRejectedValue(
        new Error(`Token used too late: {"email":"${email}"} ${idToken}`),
      );

      await expect(service.loginWithGoogleIdToken(idToken)).rejects.toThrow(
        'Invalid Google id_token',
      );

      expect(logged.length).toBeGreaterThan(0);
      expect(renderLogCalls(logged)).not.toContain(idToken);
      expect(renderLogCalls(logged)).not.toContain(email);
    });

    it('logs neither the Apple id_token nor its payload', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockRejectedValue(
        new Error(`jwt rejected for ${email}: ${idToken}`),
      );

      await expect(service.loginWithAppleIdToken(idToken)).rejects.toThrow(
        'Invalid Apple id_token',
      );

      expect(logged.length).toBeGreaterThan(0);
      expect(renderLogCalls(logged)).not.toContain(idToken);
      expect(renderLogCalls(logged)).not.toContain(email);
    });
  });
});
