import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { BadRequestException } from '@nestjs/common';
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
  let service: OAuthService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let passwordService: jest.Mocked<PasswordService>;
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
      updateUserWithRelations: jest.fn(),
      deleteAllUserSessions: jest.fn(),
      deleteAllUserDeviceTokens: jest.fn(),
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

    describe('pre-registered unverified account', () => {
      const attackerOwned = {
        ...mockUser,
        id: 'victim-account',
        email: 'victim@example.com',
        isEmailVerified: false,
        googleId: null,
        passwordHash: 'attacker-chosen-hash',
      };

      beforeEach(() => {
        googleClient.verifyIdToken.mockResolvedValue({
          getPayload: () => ({
            sub: 'google-victim',
            email: 'victim@example.com',
            email_verified: true,
          }),
        });
        authRepository.findUserByGoogleId.mockResolvedValue(null);
        authRepository.findUserByEmail.mockResolvedValue(attackerOwned);
        authRepository.updateUserWithRelations.mockResolvedValue({
          ...attackerOwned,
          isEmailVerified: true,
        });
        authRepository.countKidsByParentId.mockResolvedValue(0);
        passwordService.hashPassword.mockResolvedValue('rotated-hash');
        tokenService.createTokenPair.mockResolvedValue({
          jwt: 'j',
          refreshToken: 'r',
        });
      });

      it('revokes every existing session and replaces the password before verifying', async () => {
        await service.loginWithGoogleIdToken('valid-token');

        expect(authRepository.deleteAllUserSessions).toHaveBeenCalledWith(
          'victim-account',
        );
        const update = authRepository.updateUserWithRelations.mock.calls[0];
        expect(update[0]).toBe('victim-account');
        expect(update[1]).toMatchObject({
          isEmailVerified: true,
          hasLocalPassword: false,
          googleId: 'google-victim',
          appleId: null,
          pinHash: null,
          biometricsEnabled: false,
        });
        expect(authRepository.deleteAllUserDeviceTokens).toHaveBeenCalledWith(
          'victim-account',
        );
        expect(update[1].passwordHash).toBeDefined();
        expect(update[1].passwordHash).not.toBe('attacker-chosen-hash');
        expect(
          authRepository.deleteAllUserSessions.mock.invocationCallOrder[0],
        ).toBeLessThan(
          authRepository.updateUserWithRelations.mock.invocationCallOrder[0],
        );
      });

      it('drops a Google id the attacker linked earlier when the owner arrives through Google', async () => {
        authRepository.findUserByEmail.mockResolvedValue({
          ...attackerOwned,
          googleId: 'attacker-google-sub',
          appleId: 'attacker-apple-sub',
        });
        await service.loginWithGoogleIdToken('valid-token');

        const data = authRepository.updateUserWithRelations.mock.calls[0][1];
        expect(data.googleId).toBe('google-victim');
        expect(data.appleId).toBeNull();
      });

      it('leaves sessions and password alone for an already verified account', async () => {
        authRepository.findUserByEmail.mockResolvedValue({
          ...attackerOwned,
          isEmailVerified: true,
        });
        await service.loginWithGoogleIdToken('valid-token');

        expect(authRepository.deleteAllUserSessions).not.toHaveBeenCalled();
        expect(
          authRepository.updateUserWithRelations.mock.calls[0][1],
        ).not.toHaveProperty('passwordHash');
      });
    });
  });
});
