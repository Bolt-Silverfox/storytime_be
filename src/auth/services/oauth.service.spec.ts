import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
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
      findUserByEmailInsensitive: jest.fn(),
      updateUser: jest.fn(),
      updateUserWithRelations: jest.fn(),
      takeOverUnverifiedAccount: jest.fn(),
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
        authRepository.findUserByEmailInsensitive.mockResolvedValue(
          attackerOwned,
        );
        authRepository.takeOverUnverifiedAccount.mockResolvedValue({
          ...attackerOwned,
          isEmailVerified: true,
        });
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

      it('revokes sessions, device tokens and credentials in one repository call, hashing the password first', async () => {
        await service.loginWithGoogleIdToken('valid-token');

        const call = authRepository.takeOverUnverifiedAccount.mock.calls[0];
        expect(call[0]).toBe('victim-account');
        expect(call[1]).toMatchObject({
          isEmailVerified: true,
          hasLocalPassword: false,
          passwordHash: 'rotated-hash',
          googleId: 'google-victim',
          appleId: null,
          pinHash: null,
          biometricsEnabled: false,
        });
        expect(
          passwordService.hashPassword.mock.invocationCallOrder[0],
        ).toBeLessThan(
          authRepository.takeOverUnverifiedAccount.mock.invocationCallOrder[0],
        );
      });

      it('drops ids the attacker linked earlier when the owner arrives through Google', async () => {
        authRepository.findUserByEmailInsensitive.mockResolvedValue({
          ...attackerOwned,
          googleId: 'attacker-google-sub',
          appleId: 'attacker-apple-sub',
        });
        await service.loginWithGoogleIdToken('valid-token');

        const data = authRepository.takeOverUnverifiedAccount.mock.calls[0][1];
        expect(data.googleId).toBe('google-victim');
        expect(data.appleId).toBeNull();
      });

      it('leaves sessions and password alone for an already verified account', async () => {
        authRepository.findUserByEmailInsensitive.mockResolvedValue({
          ...attackerOwned,
          isEmailVerified: true,
        });
        await service.loginWithGoogleIdToken('valid-token');

        expect(authRepository.takeOverUnverifiedAccount).not.toHaveBeenCalled();
        expect(
          authRepository.updateUserWithRelations.mock.calls[0][1],
        ).not.toHaveProperty('passwordHash');
      });
    });

    describe('inactive accounts', () => {
      it.each([
        ['suspended', { isSuspended: true }],
        ['deleted', { isDeleted: true }],
      ])(
        'refuses a %s account matched by email without issuing tokens or saying the email is unverified',
        async (_label, flag) => {
          googleClient.verifyIdToken.mockResolvedValue({
            getPayload: () => ({
              sub: 'g-sub',
              email: 'owner@example.com',
              email_verified: true,
            }),
          });
          authRepository.findUserByGoogleId.mockResolvedValue(null);
          authRepository.findUserByEmailInsensitive.mockResolvedValue({
            ...mockUser,
            isEmailVerified: false,
            ...flag,
          });

          const err = await service
            .loginWithGoogleIdToken('valid-token')
            .catch((e: Error) => e);

          expect(err).toBeInstanceOf(UnauthorizedException);
          expect((err as Error).message).not.toMatch(/verified/i);
          expect(
            authRepository.takeOverUnverifiedAccount,
          ).not.toHaveBeenCalled();
          expect(tokenService.createTokenPair).not.toHaveBeenCalled();
        },
      );

      it('refuses a suspended account matched by provider id', async () => {
        googleClient.verifyIdToken.mockResolvedValue({
          getPayload: () => ({
            sub: 'g-sub',
            email: 'owner@example.com',
            email_verified: true,
          }),
        });
        authRepository.findUserByGoogleId.mockResolvedValue({
          ...mockUser,
          isSuspended: true,
        });

        await expect(
          service.loginWithGoogleIdToken('valid-token'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(tokenService.createTokenPair).not.toHaveBeenCalled();
      });
    });

    it('matches the stored email case-insensitively', async () => {
      googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'g-sub',
          email: 'mixed@example.com',
          email_verified: true,
        }),
      });
      authRepository.findUserByGoogleId.mockResolvedValue(null);
      authRepository.findUserByEmailInsensitive.mockResolvedValue({
        ...mockUser,
        email: 'Mixed@Example.com',
        isEmailVerified: true,
      });
      authRepository.updateUserWithRelations.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });
      authRepository.countKidsByParentId.mockResolvedValue(0);
      tokenService.createTokenPair.mockResolvedValue({
        jwt: 'j',
        refreshToken: 'r',
      });

      await service.loginWithGoogleIdToken('valid-token');

      expect(authRepository.findUserByEmailInsensitive).toHaveBeenCalledWith(
        'mixed@example.com',
      );
      expect(authRepository.createUser).not.toHaveBeenCalled();
    });

    describe('provider reports the email as unverified', () => {
      const existing = {
        ...mockUser,
        id: 'verified-owner',
        email: 'owner@example.com',
        isEmailVerified: true,
        googleId: 'owner-google-sub',
      };

      beforeEach(() => {
        authRepository.findUserByGoogleId.mockResolvedValue(null);
        authRepository.findUserByAppleId.mockResolvedValue(null);
        authRepository.findUserByEmailInsensitive.mockResolvedValue(existing);
      });

      const expectUntouched = () => {
        expect(
          authRepository.findUserByEmailInsensitive,
        ).not.toHaveBeenCalled();
        expect(authRepository.updateUserWithRelations).not.toHaveBeenCalled();
        expect(authRepository.takeOverUnverifiedAccount).not.toHaveBeenCalled();
        expect(authRepository.createUser).not.toHaveBeenCalled();
        expect(tokenService.createTokenPair).not.toHaveBeenCalled();
      };

      it('refuses Google without matching, linking or issuing tokens', async () => {
        googleClient.verifyIdToken.mockResolvedValue({
          getPayload: () => ({
            sub: 'attacker-sub',
            email: 'owner@example.com',
            email_verified: false,
          }),
        });

        await expect(
          service.loginWithGoogleIdToken('valid-token'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expectUntouched();
      });

      it.each(['false', false, undefined])(
        'refuses Apple when email_verified is %p',
        async (flag) => {
          (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
            sub: 'attacker-apple',
            email: 'owner@example.com',
            email_verified: flag,
          });

          await expect(
            service.loginWithAppleIdToken('valid-token'),
          ).rejects.toBeInstanceOf(BadRequestException);
          expectUntouched();
        },
      );

      it('writes nothing, not even an avatar, for an unverified account found by provider id', async () => {
        googleClient.verifyIdToken.mockResolvedValue({
          getPayload: () => ({
            sub: 'known-sub',
            email: 'owner@example.com',
            email_verified: true,
            picture: 'https://img.example/a.png',
          }),
        });
        authRepository.findUserByGoogleId.mockResolvedValue({
          ...existing,
          isEmailVerified: false,
          avatarId: null,
        });
        authRepository.findAvatarByUrl.mockResolvedValue(null);

        await expect(
          service.loginWithGoogleIdToken('valid-token'),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(authRepository.createAvatar).not.toHaveBeenCalled();
        expect(authRepository.updateUserWithRelations).not.toHaveBeenCalled();
      });

      it('still accepts Apple when email_verified is the string true', async () => {
        (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
          sub: 'owner-apple',
          email: 'owner@example.com',
          email_verified: 'true',
        });
        authRepository.updateUserWithRelations.mockResolvedValue(existing);
        authRepository.countKidsByParentId.mockResolvedValue(0);
        tokenService.createTokenPair.mockResolvedValue({
          jwt: 'j',
          refreshToken: 'r',
        });

        await expect(
          service.loginWithAppleIdToken('valid-token'),
        ).resolves.toBeDefined();
      });
    });
  });
});
