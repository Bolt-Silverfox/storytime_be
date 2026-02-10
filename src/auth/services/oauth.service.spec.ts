import { Test, TestingModule } from '@nestjs/testing';
import { OAuthService } from './oauth.service';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationPreferenceService } from '@/notification/services/notification-preference.service';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
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

// Type-safe mock for PrismaService
type MockPrismaService = {
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  avatar: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  kid: {
    count: jest.Mock;
  };
};

const createMockPrismaService = (): MockPrismaService => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  avatar: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  kid: {
    count: jest.fn(),
  },
});

type MockTokenService = {
  createTokenPair: jest.Mock;
};

const createMockTokenService = (): MockTokenService => ({
  createTokenPair: jest.fn(),
});

type MockPasswordService = {
  hashPassword: jest.Mock;
};

const createMockPasswordService = (): MockPasswordService => ({
  hashPassword: jest.fn(),
});

type MockNotificationPreferenceService = {
  seedDefaultPreferences: jest.Mock;
};

const createMockNotificationPreferenceService =
  (): MockNotificationPreferenceService => ({
    seedDefaultPreferences: jest.fn(),
  });

describe('OAuthService', () => {
  let service: OAuthService;
  let mockPrisma: MockPrismaService;
  let mockTokenService: MockTokenService;
  let mockPasswordService: MockPasswordService;
  let mockNotificationPreferenceService: MockNotificationPreferenceService;
  let mockGoogleClient: { verifyIdToken: jest.Mock };

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
    profile: { language: 'en', country: 'US' },
    avatar: null,
  };

  const mockTokenPair = {
    jwt: 'jwt-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockTokenService = createMockTokenService();
    mockPasswordService = createMockPasswordService();
    mockNotificationPreferenceService =
      createMockNotificationPreferenceService();

    jest.clearAllMocks();

    // Set environment variables
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.APPLE_CLIENT_ID = 'test-apple-client-id';
    process.env.APPLE_SERVICE_ID = 'test-apple-service-id';

    // Setup mock Google client
    mockGoogleClient = { verifyIdToken: jest.fn() };
    (OAuth2Client as unknown as jest.Mock).mockImplementation(
      () => mockGoogleClient,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        { provide: PasswordService, useValue: mockPasswordService },
        {
          provide: NotificationPreferenceService,
          useValue: mockNotificationPreferenceService,
        },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== GOOGLE OAUTH TESTS ====================

  describe('loginWithGoogleIdToken', () => {
    it('should throw BadRequestException when id_token is missing', async () => {
      await expect(service.loginWithGoogleIdToken('')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.loginWithGoogleIdToken('')).rejects.toThrow(
        'id_token is required',
      );
    });

    it('should throw ServiceUnavailableException when Google client is not configured', async () => {
      // Create a new service without GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_ID;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OAuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: TokenService, useValue: mockTokenService },
          { provide: PasswordService, useValue: mockPasswordService },
          {
            provide: NotificationPreferenceService,
            useValue: mockNotificationPreferenceService,
          },
        ],
      }).compile();

      const serviceWithoutClient = module.get<OAuthService>(OAuthService);

      await expect(
        serviceWithoutClient.loginWithGoogleIdToken('valid-token'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw UnauthorizedException when Google token verification fails', async () => {
      mockGoogleClient.verifyIdToken.mockRejectedValue(
        new Error('Invalid token'),
      );

      await expect(
        service.loginWithGoogleIdToken('invalid-token'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.loginWithGoogleIdToken('invalid-token'),
      ).rejects.toThrow('Invalid Google id_token');
    });

    it('should throw UnauthorizedException when payload is missing email', async () => {
      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({ sub: 'google-123' }), // No email
      });

      await expect(
        service.loginWithGoogleIdToken('valid-token'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.loginWithGoogleIdToken('valid-token'),
      ).rejects.toThrow('Invalid Google token payload');
    });

    it('should login existing user by googleId', async () => {
      const googlePayload = {
        sub: 'google-123',
        email: 'test@example.com',
        picture: 'https://example.com/avatar.jpg',
        given_name: 'Test',
        family_name: 'User',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      // User already has this avatar
      const existingAvatar = {
        id: 'existing-avatar-id',
        url: 'https://example.com/avatar.jpg',
      };
      const userWithAvatar = {
        ...mockUser,
        avatarId: 'existing-avatar-id',
        avatar: existingAvatar,
      };
      mockPrisma.user.findFirst.mockResolvedValue(userWithAvatar);
      mockPrisma.avatar.findFirst.mockResolvedValue(existingAvatar);
      mockPrisma.kid.count.mockResolvedValue(2);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithGoogleIdToken('valid-token');

      expect(result).toBeDefined();
      expect(result.jwt).toBe('jwt-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.email).toBe('test@example.com');
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { googleId: 'google-123' },
        include: { profile: true, avatar: true },
      });
    });

    it('should link existing email account to Google', async () => {
      const googlePayload = {
        sub: 'google-456',
        email: 'existing@example.com',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      // No user found by googleId
      mockPrisma.user.findFirst.mockResolvedValue(null);
      // User found by email
      const existingUser = {
        ...mockUser,
        id: 'existing-user',
        email: 'existing@example.com',
        googleId: null,
      };
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue({
        ...existingUser,
        googleId: 'google-456',
      });
      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithGoogleIdToken('valid-token');

      expect(result).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'existing-user' },
        data: expect.objectContaining({
          googleId: 'google-456',
        }),
        include: { profile: true, avatar: true },
      });
    });

    it('should create new user for new Google account', async () => {
      const googlePayload = {
        sub: 'google-new',
        email: 'new@example.com',
        picture: 'https://example.com/new-avatar.jpg',
        given_name: 'New',
        family_name: 'User',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      // No existing user
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed_random');

      const newUser = {
        id: 'new-user-id',
        email: 'new@example.com',
        name: 'New User',
        googleId: 'google-new',
        appleId: null,
        isEmailVerified: true,
        role: 'parent',
        avatarId: null,
        profile: { country: 'NG' },
        avatar: null,
      };
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockNotificationPreferenceService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );

      // Avatar creation for picture
      mockPrisma.avatar.findFirst.mockResolvedValue(null);
      const newAvatar = {
        id: 'avatar-1',
        url: 'https://example.com/new-avatar.jpg',
        name: 'oauth_google-new',
        isSystemAvatar: false,
      };
      mockPrisma.avatar.create.mockResolvedValue(newAvatar);
      mockPrisma.user.update.mockResolvedValue({
        ...newUser,
        avatarId: 'avatar-1',
        avatar: newAvatar,
      });

      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithGoogleIdToken('valid-token');

      expect(result).toBeDefined();
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'new@example.com',
          name: 'New User',
          googleId: 'google-new',
          role: 'parent',
          isEmailVerified: true,
        }),
        include: { profile: true, avatar: true },
      });
      expect(
        mockNotificationPreferenceService.seedDefaultPreferences,
      ).toHaveBeenCalledWith('new-user-id');
    });

    it('should throw BadRequestException when email is not verified', async () => {
      const googlePayload = {
        sub: 'google-unverified',
        email: 'unverified@example.com',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed_random');

      const unverifiedUser = {
        id: 'unverified-user',
        email: 'unverified@example.com',
        isEmailVerified: false,
        profile: { country: 'NG' },
        avatar: null,
      };
      mockPrisma.user.create.mockResolvedValue(unverifiedUser);
      mockNotificationPreferenceService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );

      await expect(
        service.loginWithGoogleIdToken('valid-token'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.loginWithGoogleIdToken('valid-token'),
      ).rejects.toThrow('Email not verified');
    });

    it('should handle notification preference seeding failure gracefully', async () => {
      const googlePayload = {
        sub: 'google-new',
        email: 'new@example.com',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed_random');

      const newUser = {
        id: 'new-user-id',
        email: 'new@example.com',
        isEmailVerified: true,
        profile: { country: 'NG' },
        avatar: null,
      };
      mockPrisma.user.create.mockResolvedValue(newUser);
      // Seeding fails but should not throw
      mockNotificationPreferenceService.seedDefaultPreferences.mockRejectedValue(
        new Error('Seeding failed'),
      );

      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      // Should still succeed
      const result = await service.loginWithGoogleIdToken('valid-token');
      expect(result).toBeDefined();
    });
  });

  describe('handleGoogleOAuthPayload', () => {
    it('should process Google OAuth payload from strategy', async () => {
      const payload = {
        provider: 'google' as const,
        providerId: 'google-strategy-123',
        email: 'strategy@example.com',
        picture: 'https://example.com/strategy-avatar.jpg',
        firstName: 'Strategy',
        lastName: 'User',
        emailVerified: true,
      };

      // User already has this avatar
      const existingAvatar = {
        id: 'strategy-avatar-id',
        url: 'https://example.com/strategy-avatar.jpg',
      };
      const userWithAvatar = {
        ...mockUser,
        googleId: 'google-strategy-123',
        email: 'strategy@example.com',
        avatarId: 'strategy-avatar-id',
        avatar: existingAvatar,
      };
      mockPrisma.user.findFirst.mockResolvedValue(userWithAvatar);
      mockPrisma.avatar.findFirst.mockResolvedValue(existingAvatar);
      mockPrisma.kid.count.mockResolvedValue(1);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.handleGoogleOAuthPayload(payload);

      expect(result).toBeDefined();
      expect(result.jwt).toBe('jwt-token');
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { googleId: 'google-strategy-123' },
        include: { profile: true, avatar: true },
      });
    });

    it('should handle payload with missing names', async () => {
      const payload = {
        provider: 'google' as const,
        providerId: 'google-noname',
        email: 'noname@example.com',
        picture: undefined,
        firstName: '',
        lastName: '',
        emailVerified: true,
      };

      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed');

      const newUser = {
        id: 'user-noname',
        email: 'noname@example.com',
        name: 'noname@example.com', // Falls back to email
        isEmailVerified: true,
        googleId: 'google-noname',
        profile: { country: 'NG' },
        avatar: null,
      };
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockNotificationPreferenceService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );
      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.handleGoogleOAuthPayload(payload);

      expect(result).toBeDefined();
    });
  });

  // ==================== APPLE OAUTH TESTS ====================

  describe('loginWithAppleIdToken', () => {
    it('should throw BadRequestException when id_token is missing', async () => {
      await expect(service.loginWithAppleIdToken('')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.loginWithAppleIdToken('')).rejects.toThrow(
        'id_token is required',
      );
    });

    it('should throw UnauthorizedException when Apple token verification fails', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockRejectedValue(
        new Error('Invalid Apple token'),
      );

      await expect(
        service.loginWithAppleIdToken('invalid-apple-token'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.loginWithAppleIdToken('invalid-apple-token'),
      ).rejects.toThrow('Invalid Apple id_token');
    });

    it('should login existing user by appleId', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-123',
        email: 'apple@example.com',
        email_verified: 'true',
      });

      const appleUser = {
        ...mockUser,
        googleId: null,
        appleId: 'apple-123',
        email: 'apple@example.com',
      };
      // For Apple login, only one findFirst call is made (for appleId)
      mockPrisma.user.findFirst.mockResolvedValue(appleUser);
      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithAppleIdToken('valid-apple-token');

      expect(result).toBeDefined();
      expect(result.jwt).toBe('jwt-token');
      expect(appleSigninAuth.verifyIdToken).toHaveBeenCalledWith(
        'valid-apple-token',
        {
          audience: [process.env.APPLE_CLIENT_ID, process.env.APPLE_SERVICE_ID],
          nonce: 'NONCE',
          ignoreExpiration: false,
        },
      );
    });

    it('should create new user for new Apple account with names', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-new',
        email: 'newapple@example.com',
        email_verified: true,
      });

      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed_random');

      const newAppleUser = {
        id: 'new-apple-user',
        email: 'newapple@example.com',
        name: 'John Doe',
        appleId: 'apple-new',
        googleId: null,
        isEmailVerified: true,
        role: 'parent',
        profile: { country: 'NG' },
        avatar: null,
      };
      mockPrisma.user.create.mockResolvedValue(newAppleUser);
      mockNotificationPreferenceService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );
      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithAppleIdToken(
        'valid-apple-token',
        'John',
        'Doe',
      );

      expect(result).toBeDefined();
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'John Doe',
          email: 'newapple@example.com',
          appleId: 'apple-new',
        }),
        include: { profile: true, avatar: true },
      });
    });

    it('should create user without name when names are not provided', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-noname',
        email: 'noname-apple@example.com',
        email_verified: 'true',
      });

      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed_random');

      const newUser = {
        id: 'apple-noname-user',
        email: 'noname-apple@example.com',
        name: 'noname-apple@example.com', // Falls back to email
        appleId: 'apple-noname',
        isEmailVerified: true,
        profile: { country: 'NG' },
        avatar: null,
      };
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockNotificationPreferenceService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );
      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithAppleIdToken('valid-apple-token');

      expect(result).toBeDefined();
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: expect.any(String), // Either email or 'User'
        }),
        include: { profile: true, avatar: true },
      });
    });

    it('should link existing email account to Apple', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-link',
        email: 'existing@example.com',
        email_verified: true,
      });

      mockPrisma.user.findFirst.mockResolvedValue(null);
      const existingUser = {
        ...mockUser,
        email: 'existing@example.com',
        appleId: null,
      };
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue({
        ...existingUser,
        appleId: 'apple-link',
      });
      mockPrisma.kid.count.mockResolvedValue(1);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithAppleIdToken('valid-apple-token');

      expect(result).toBeDefined();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: existingUser.id },
        data: expect.objectContaining({
          appleId: 'apple-link',
        }),
        include: { profile: true, avatar: true },
      });
    });

    it('should handle email_verified as string "true"', async () => {
      (appleSigninAuth.verifyIdToken as jest.Mock).mockResolvedValue({
        sub: 'apple-string-verified',
        email: 'stringverified@example.com',
        email_verified: 'true', // String instead of boolean
      });

      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed');

      const newUser = {
        id: 'string-verified-user',
        email: 'stringverified@example.com',
        isEmailVerified: true,
        appleId: 'apple-string-verified',
        profile: { country: 'NG' },
        avatar: null,
      };
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockNotificationPreferenceService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );
      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      const result = await service.loginWithAppleIdToken('valid-apple-token');

      expect(result).toBeDefined();
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isEmailVerified: true,
        }),
        include: { profile: true, avatar: true },
      });
    });
  });

  // ==================== AVATAR HANDLING TESTS ====================

  describe('Avatar handling in OAuth', () => {
    it('should create and assign avatar when picture URL is provided', async () => {
      const googlePayload = {
        sub: 'google-with-picture',
        email: 'picture@example.com',
        picture: 'https://example.com/new-picture.jpg',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      const userWithoutAvatar = {
        ...mockUser,
        googleId: 'google-with-picture',
        avatarId: null,
        avatar: null,
      };
      mockPrisma.user.findFirst.mockResolvedValue(userWithoutAvatar);

      // No existing avatar with this URL
      mockPrisma.avatar.findFirst.mockResolvedValue(null);

      const newAvatar = {
        id: 'new-avatar-id',
        url: 'https://example.com/new-picture.jpg',
        name: 'oauth_google-with-picture',
        isSystemAvatar: false,
      };
      mockPrisma.avatar.create.mockResolvedValue(newAvatar);

      mockPrisma.user.update.mockResolvedValue({
        ...userWithoutAvatar,
        avatarId: 'new-avatar-id',
        avatar: newAvatar,
      });

      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      await service.loginWithGoogleIdToken('valid-token');

      expect(mockPrisma.avatar.create).toHaveBeenCalledWith({
        data: {
          url: 'https://example.com/new-picture.jpg',
          name: 'oauth_google-with-picture',
          isSystemAvatar: false,
        },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userWithoutAvatar.id },
        data: { avatarId: 'new-avatar-id' },
        include: { profile: true, avatar: true },
      });
    });

    it('should reuse existing avatar if URL already exists', async () => {
      const googlePayload = {
        sub: 'google-existing-avatar',
        email: 'existing-avatar@example.com',
        picture: 'https://example.com/existing.jpg',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      const userWithoutAvatar = {
        ...mockUser,
        googleId: 'google-existing-avatar',
        avatarId: null,
        avatar: null,
      };
      mockPrisma.user.findFirst.mockResolvedValue(userWithoutAvatar);

      const existingAvatar = {
        id: 'existing-avatar-id',
        url: 'https://example.com/existing.jpg',
        name: 'some-avatar',
        isSystemAvatar: false,
      };
      mockPrisma.avatar.findFirst.mockResolvedValue(existingAvatar);

      mockPrisma.user.update.mockResolvedValue({
        ...userWithoutAvatar,
        avatarId: 'existing-avatar-id',
        avatar: existingAvatar,
      });

      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      await service.loginWithGoogleIdToken('valid-token');

      expect(mockPrisma.avatar.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userWithoutAvatar.id },
        data: { avatarId: 'existing-avatar-id' },
        include: { profile: true, avatar: true },
      });
    });

    it('should not update avatar if user already has the same avatar', async () => {
      const googlePayload = {
        sub: 'google-same-avatar',
        email: 'same-avatar@example.com',
        picture: 'https://example.com/same.jpg',
        email_verified: true,
      };

      mockGoogleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => googlePayload,
      });

      const existingAvatar = {
        id: 'same-avatar-id',
        url: 'https://example.com/same.jpg',
      };

      const userWithSameAvatar = {
        ...mockUser,
        googleId: 'google-same-avatar',
        avatarId: 'same-avatar-id',
        avatar: existingAvatar,
      };
      mockPrisma.user.findFirst.mockResolvedValue(userWithSameAvatar);
      mockPrisma.avatar.findFirst.mockResolvedValue(existingAvatar);

      mockPrisma.kid.count.mockResolvedValue(0);
      mockTokenService.createTokenPair.mockResolvedValue(mockTokenPair);

      await service.loginWithGoogleIdToken('valid-token');

      // Should not call update since avatar is already the same
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
