import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountLinkingService } from './account-linking.service';
import { AUTH_REPOSITORY } from '../repositories';

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn().mockResolvedValue({
      getPayload: () => ({ sub: 'google-sub' }),
    }),
  })),
}));
jest.mock('apple-signin-auth', () => ({
  __esModule: true,
  default: { verifyIdToken: jest.fn().mockResolvedValue({ sub: 'apple-sub' }) },
}));

describe('AccountLinkingService', () => {
  let service: AccountLinkingService;
  let authRepository: {
    findActiveUserById: jest.Mock;
    findSessionById: jest.Mock;
    findUserLinkedAccountInfo: jest.Mock;
    linkGoogleAccountIfUnset: jest.Mock;
    linkAppleAccountIfUnset: jest.Mock;
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    const mockAuthRepository = {
      findActiveUserById: jest.fn(),
      findSessionById: jest.fn(),
      findUserLinkedAccountInfo: jest.fn(),
      linkGoogleAccountIfUnset: jest.fn(),
      linkAppleAccountIfUnset: jest.fn(),
      transaction: jest.fn(),
    };

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountLinkingService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((k: string) => `cfg-${k}`) },
        },
      ],
    }).compile();

    service = module.get<AccountLinkingService>(AccountLinkingService);
    authRepository = module.get(AUTH_REPOSITORY);
  });

  describe.each([
    ['google', 'linkGoogle', 'linkGoogleAccountIfUnset'],
    ['apple', 'linkApple', 'linkAppleAccountIfUnset'],
  ] as const)(
    '%s linking while the email is unverified',
    (_p, method, repoFn) => {
      it('refuses with a 403 instead of attaching the identity', async () => {
        authRepository[repoFn].mockResolvedValue({ count: 0 });
        authRepository.findActiveUserById.mockResolvedValue({
          id: 'user-1',
          isEmailVerified: false,
        });

        await expect(service[method]('user-1', 'token')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });

      it('reports an expired session instead of already linked when the caller session is gone', async () => {
        authRepository[repoFn].mockResolvedValue({ count: 0 });
        authRepository.findSessionById.mockResolvedValue(null);
        authRepository.findActiveUserById.mockResolvedValue({
          id: 'user-1',
          isEmailVerified: true,
        });

        await expect(
          service[method]('user-1', 'token', 'session-9'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      });

      it('reports an expired session when the caller session was soft-revoked', async () => {
        authRepository[repoFn].mockResolvedValue({ count: 0 });
        authRepository.findSessionById.mockResolvedValue({
          id: 'session-9',
          isDeleted: true,
        });
        authRepository.findActiveUserById.mockResolvedValue({
          id: 'user-1',
          isEmailVerified: true,
        });

        await expect(
          service[method]('user-1', 'token', 'session-9'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      });

      it('still reports an already linked provider for a verified account', async () => {
        authRepository[repoFn].mockResolvedValue({ count: 0 });
        authRepository.findActiveUserById.mockResolvedValue({
          id: 'user-1',
          isEmailVerified: true,
        });

        await expect(service[method]('user-1', 'token')).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });
    },
  );

  it.each([
    ['linkGoogle', 'linkGoogleAccountIfUnset', 'google-sub'],
    ['linkApple', 'linkAppleAccountIfUnset', 'apple-sub'],
  ] as const)(
    '%s ties the write to the caller session',
    async (method, repoFn, sub) => {
      authRepository[repoFn].mockResolvedValue({ count: 1 });

      await service[method]('user-1', 'token', 'session-9');

      expect(authRepository[repoFn]).toHaveBeenCalledWith(
        'user-1',
        sub,
        'session-9',
      );
    },
  );

  describe('getLinkedAccounts', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      authRepository.findUserLinkedAccountInfo.mockResolvedValue(null);

      await expect(service.getLinkedAccounts('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should list email, google and apple providers when all present', async () => {
      authRepository.findUserLinkedAccountInfo.mockResolvedValue({
        email: 'test@example.com',
        googleId: 'g-1',
        appleId: 'a-1',
        hasLocalPassword: true,
      });

      const result = await service.getLinkedAccounts('user-1');

      expect(result).toEqual({
        success: true,
        message: 'Linked accounts retrieved',
        statusCode: 200,
        data: [
          { provider: 'email', email: 'test@example.com', linkedAt: null },
          { provider: 'google', email: 'test@example.com', linkedAt: null },
          { provider: 'apple', email: 'test@example.com', linkedAt: null },
        ],
      });
    });

    it('should omit email provider when user has no local password', async () => {
      authRepository.findUserLinkedAccountInfo.mockResolvedValue({
        email: 'test@example.com',
        googleId: 'g-1',
        appleId: null,
        hasLocalPassword: false,
      });

      const result = await service.getLinkedAccounts('user-1');

      expect(result.data).toEqual([
        { provider: 'google', email: 'test@example.com', linkedAt: null },
      ]);
    });
  });

  describe('unlinkProvider', () => {
    it('should reject an invalid provider', async () => {
      await expect(
        service.unlinkProvider('user-1', 'facebook'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user not found in transaction', async () => {
      authRepository.transaction.mockImplementation((fn) =>
        fn({
          findActiveUserLinkedProviderFields: jest.fn().mockResolvedValue(null),
          unlinkProviderField: jest.fn(),
        }),
      );

      await expect(service.unlinkProvider('user-1', 'google')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject unlinking a provider that is not linked', async () => {
      authRepository.transaction.mockImplementation((fn) =>
        fn({
          findActiveUserLinkedProviderFields: jest.fn().mockResolvedValue({
            googleId: null,
            appleId: 'a-1',
            hasLocalPassword: true,
          }),
          unlinkProviderField: jest.fn(),
        }),
      );

      await expect(service.unlinkProvider('user-1', 'google')).rejects.toThrow(
        'google account is not linked.',
      );
    });

    it('should reject unlinking the last remaining sign-in method', async () => {
      authRepository.transaction.mockImplementation((fn) =>
        fn({
          findActiveUserLinkedProviderFields: jest.fn().mockResolvedValue({
            googleId: 'g-1',
            appleId: null,
            hasLocalPassword: false,
          }),
          unlinkProviderField: jest.fn(),
        }),
      );

      await expect(service.unlinkProvider('user-1', 'google')).rejects.toThrow(
        'Cannot unlink. You must have at least one linked sign-in method.',
      );
    });

    it('should unlink a provider when another sign-in method remains', async () => {
      const unlinkProviderField = jest.fn().mockResolvedValue(undefined);
      authRepository.transaction.mockImplementation((fn) =>
        fn({
          findActiveUserLinkedProviderFields: jest.fn().mockResolvedValue({
            googleId: 'g-1',
            appleId: null,
            hasLocalPassword: true,
          }),
          unlinkProviderField,
        }),
      );

      const result = await service.unlinkProvider('user-1', 'google');

      expect(unlinkProviderField).toHaveBeenCalledWith('user-1', 'googleId');
      expect(result).toEqual({
        success: true,
        message: 'google account unlinked successfully',
        statusCode: 200,
        data: null,
      });
    });
  });
});
