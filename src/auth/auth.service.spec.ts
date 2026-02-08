import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notification/notification.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import * as bcrypt from 'bcryptjs';

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

// Mock OAuth clients
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

jest.mock('apple-signin-auth', () => ({
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
  token: {
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  profile: {
    update: jest.Mock;
    upsert: jest.Mock;
    create: jest.Mock;
  };
  avatar: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  learningExpectation: {
    findMany: jest.Mock;
  };
  userLearningExpectation: {
    createMany: jest.Mock;
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
  token: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  profile: {
    update: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
  },
  avatar: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  learningExpectation: {
    findMany: jest.fn(),
  },
  userLearningExpectation: {
    createMany: jest.fn(),
  },
  kid: {
    count: jest.fn(),
  },
});

type MockTokenService = {
  createTokenPair: jest.Mock;
  generateJwt: jest.Mock;
  findSessionByRefreshToken: jest.Mock;
  deleteSession: jest.Mock;
  deleteAllUserSessions: jest.Mock;
  hashToken: jest.Mock;
};

const createMockTokenService = (): MockTokenService => ({
  createTokenPair: jest.fn(),
  generateJwt: jest.fn(),
  findSessionByRefreshToken: jest.fn(),
  deleteSession: jest.fn(),
  deleteAllUserSessions: jest.fn(),
  hashToken: jest.fn((token: string) => `hashed_${token}`),
});

type MockPasswordService = {
  hashPassword: jest.Mock;
  requestPasswordReset: jest.Mock;
  validateResetToken: jest.Mock;
  resetPassword: jest.Mock;
  changePassword: jest.Mock;
};

const createMockPasswordService = (): MockPasswordService => ({
  hashPassword: jest.fn(),
  requestPasswordReset: jest.fn(),
  validateResetToken: jest.fn(),
  resetPassword: jest.fn(),
  changePassword: jest.fn(),
});

type MockNotificationService = {
  sendNotification: jest.Mock;
  seedDefaultPreferences: jest.Mock;
};

const createMockNotificationService = (): MockNotificationService => ({
  sendNotification: jest.fn(),
  seedDefaultPreferences: jest.fn(),
});

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: MockPrismaService;
  let mockTokenService: MockTokenService;
  let mockPasswordService: MockPasswordService;
  let mockNotificationService: MockNotificationService;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed_password',
    isEmailVerified: true,
    role: 'parent',
    onboardingStatus: 'email_verified',
    profile: { language: 'en', country: 'US' },
    avatar: null,
    _count: { kids: 2 },
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();
    mockTokenService = createMockTokenService();
    mockPasswordService = createMockPasswordService();
    mockNotificationService = createMockNotificationService();

    jest.clearAllMocks();

    // Set environment variable for Google Client
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== LOGIN TESTS ====================

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockTokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toBeDefined();
      expect(result?.jwt).toBe('jwt-token');
      expect(result?.refreshToken).toBe('refresh-token');
      expect(result?.user.email).toBe('test@example.com');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        include: {
          profile: true,
          avatar: true,
          _count: { select: { kids: true } },
        },
      });
    });

    it('should throw BadRequestException for invalid email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'wrong@example.com', password: 'password123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for unverified email', async () => {
      const unverifiedUser = { ...mockUser, isEmailVerified: false };
      mockPrisma.user.findUnique.mockResolvedValue(unverifiedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== REFRESH TESTS ====================

  describe('refresh', () => {
    it('should refresh token successfully with valid refresh token', async () => {
      const session = {
        id: 'session-1',
        user: {
          ...mockUser,
          _count: { kids: 2 },
        },
      };
      mockTokenService.findSessionByRefreshToken.mockResolvedValue(session);
      mockTokenService.generateJwt.mockReturnValue('new-jwt-token');

      const result = await service.refresh('valid-refresh-token');

      expect(result).toBeDefined();
      expect(result?.jwt).toBe('new-jwt-token');
      expect(result?.user.numberOfKids).toBe(2);
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockTokenService.findSessionByRefreshToken.mockResolvedValue(null);

      await expect(service.refresh('invalid-refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ==================== LOGOUT TESTS ====================

  describe('logout', () => {
    it('should logout successfully', async () => {
      mockTokenService.deleteSession.mockResolvedValue(true);

      const result = await service.logout('session-1');

      expect(result).toBe(true);
      expect(mockTokenService.deleteSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('logoutAllDevices', () => {
    it('should logout all devices successfully', async () => {
      mockTokenService.deleteAllUserSessions.mockResolvedValue(true);

      const result = await service.logoutAllDevices('user-1');

      expect(result).toBe(true);
      expect(mockTokenService.deleteAllUserSessions).toHaveBeenCalledWith(
        'user-1',
      );
    });
  });

  // ==================== REGISTRATION TESTS ====================

  describe('register', () => {
    it('should register a new user successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPasswordService.hashPassword.mockResolvedValue('hashed_password');
      mockPrisma.user.create.mockResolvedValue({
        ...mockUser,
        isEmailVerified: false,
      });
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });
      mockNotificationService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );
      mockTokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      const result = await service.register({
        fullName: 'New User',
        email: 'new@example.com',
        password: 'password123',
      });

      expect(result).toBeDefined();
      expect(result?.jwt).toBe('jwt-token');
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.register({
          fullName: 'New User',
          email: 'test@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException for invalid admin secret', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      process.env.ADMIN_SECRET = 'correct-secret';

      await expect(
        service.register({
          fullName: 'Admin User',
          email: 'admin@example.com',
          password: 'password123',
          role: 'admin',
          adminSecret: 'wrong-secret',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin registration with valid admin secret', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      process.env.ADMIN_SECRET = 'correct-secret';
      mockPasswordService.hashPassword.mockResolvedValue('hashed_password');
      mockPrisma.user.create.mockResolvedValue({
        ...mockUser,
        role: 'admin',
        isEmailVerified: false,
      });
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });
      mockNotificationService.seedDefaultPreferences.mockResolvedValue(
        undefined,
      );
      mockTokenService.createTokenPair.mockResolvedValue({
        jwt: 'jwt-token',
        refreshToken: 'refresh-token',
      });

      const result = await service.register({
        fullName: 'Admin User',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin',
        adminSecret: 'correct-secret',
      });

      expect(result).toBeDefined();
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'admin',
          }),
        }),
      );
    });
  });

  // ==================== EMAIL VERIFICATION TESTS ====================

  describe('sendEmailVerification', () => {
    it('should send email verification successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.token.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.token.create.mockResolvedValue({ id: 'token-1' });
      mockNotificationService.sendNotification.mockResolvedValue({
        success: true,
      });

      const result = await service.sendEmailVerification('test@example.com');

      expect(result.message).toBe('Verification email sent');
      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(
        'EmailVerification',
        expect.objectContaining({ email: 'test@example.com' }),
      );
    });

    it('should throw NotFoundException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.sendEmailVerification('nonexistent@example.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ServiceUnavailableException if email fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.token.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.token.create.mockResolvedValue({ id: 'token-1' });
      mockNotificationService.sendNotification.mockResolvedValue({
        success: false,
        error: 'Email service unavailable',
      });

      await expect(
        service.sendEmailVerification('test@example.com'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('verifyEmail', () => {
    it('should verify email successfully', async () => {
      const verificationToken = {
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600000),
        user: mockUser,
      };
      mockPrisma.token.findUnique.mockResolvedValue(verificationToken);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        isEmailVerified: true,
      });
      mockPrisma.token.delete.mockResolvedValue(verificationToken);

      const result = await service.verifyEmail('valid-token');

      expect(result.message).toBe('Email verified successfully');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          isEmailVerified: true,
          onboardingStatus: 'email_verified',
        },
      });
    });

    it('should throw BadRequestException for invalid token', async () => {
      mockPrisma.token.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail('invalid-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw UnauthorizedException for expired token', async () => {
      const expiredToken = {
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
        user: mockUser,
      };
      mockPrisma.token.findUnique.mockResolvedValue(expiredToken);
      mockPrisma.token.delete.mockResolvedValue(expiredToken);

      await expect(service.verifyEmail('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ==================== PASSWORD DELEGATION TESTS ====================

  describe('requestPasswordReset', () => {
    it('should delegate to passwordService', async () => {
      mockPasswordService.requestPasswordReset.mockResolvedValue({
        message: 'Token sent',
      });

      const result = await service.requestPasswordReset(
        { email: 'test@example.com' },
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(result.message).toBe('Token sent');
      expect(mockPasswordService.requestPasswordReset).toHaveBeenCalledWith(
        { email: 'test@example.com' },
        '127.0.0.1',
        'Mozilla/5.0',
      );
    });
  });

  describe('validateResetToken', () => {
    it('should delegate to passwordService', async () => {
      mockPasswordService.validateResetToken.mockResolvedValue({
        message: 'Valid token',
      });

      const result = await service.validateResetToken(
        'token',
        'test@example.com',
        { token: 'token', email: 'test@example.com' },
      );

      expect(result.message).toBe('Valid token');
    });
  });

  describe('resetPassword', () => {
    it('should delegate to passwordService', async () => {
      mockPasswordService.resetPassword.mockResolvedValue({
        message: 'Password reset',
      });

      const result = await service.resetPassword(
        'token',
        'test@example.com',
        'NewPassword1#',
        { token: 'token', email: 'test@example.com', newPassword: 'NewPassword1#' },
      );

      expect(result.message).toBe('Password reset');
    });
  });

  describe('changePassword', () => {
    it('should delegate to passwordService', async () => {
      mockPasswordService.changePassword.mockResolvedValue({
        message: 'Password changed',
      });

      const result = await service.changePassword(
        'user-1',
        { oldPassword: 'old', newPassword: 'new' },
        'session-1',
      );

      expect(result.message).toBe('Password changed');
    });
  });
});
