import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  InvalidCredentialsException,
  InvalidTokenException,
  EmailNotVerifiedException,
} from '@/shared/exceptions';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { AUTH_REPOSITORY, IAuthRepository } from './repositories';
import { UserDto } from './dto/auth.dto';

describe('AuthService', () => {
  let service: AuthService;
  let authRepository: jest.Mocked<IAuthRepository>;
  let tokenService: jest.Mocked<TokenService>;
  let passwordService: jest.Mocked<PasswordService>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed_password',
    isEmailVerified: true,
    role: 'parent',
    _count: { kids: 2 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockAuthRepository = {
      findUserByEmailWithRelations: jest.fn(),
    };

    const mockTokenService = {
      createTokenPair: jest.fn(),
      findSessionByRefreshToken: jest.fn(),
      generateJwt: jest.fn(),
      deleteSession: jest.fn(),
      deleteAllUserSessions: jest.fn(),
    };

    const mockPasswordService = {
      verifyPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: TokenService, useValue: mockTokenService },
        { provide: PasswordService, useValue: mockPasswordService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    authRepository = module.get(AUTH_REPOSITORY);
    tokenService = module.get(TokenService);
    passwordService = module.get(PasswordService);
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      authRepository.findUserByEmailWithRelations.mockResolvedValue(
        mockUser as any,
      );
      passwordService.verifyPassword.mockResolvedValue(true);
      tokenService.createTokenPair.mockResolvedValue({
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
      expect(authRepository.findUserByEmailWithRelations).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should throw InvalidCredentialsException for invalid email', async () => {
      authRepository.findUserByEmailWithRelations.mockResolvedValue(null);

      await expect(
        service.login({ email: 'wrong@example.com', password: 'password123' }),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('should throw InvalidCredentialsException for invalid password', async () => {
      authRepository.findUserByEmailWithRelations.mockResolvedValue(
        mockUser as any,
      );
      passwordService.verifyPassword.mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('should throw EmailNotVerifiedException for unverified email', async () => {
      const unverifiedUser = { ...mockUser, isEmailVerified: false };
      authRepository.findUserByEmailWithRelations.mockResolvedValue(
        unverifiedUser as any,
      );
      passwordService.verifyPassword.mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(EmailNotVerifiedException);
    });
  });

  describe('refresh', () => {
    it('should refresh token successfully with valid refresh token', async () => {
      const session = {
        id: 'session-1',
        user: {
          ...mockUser,
        },
      };
      tokenService.findSessionByRefreshToken.mockResolvedValue(session as any);
      tokenService.generateJwt.mockReturnValue('new-jwt-token');

      const result = await service.refresh('valid-refresh-token');

      expect(result).toBeDefined();
      expect(result?.jwt).toBe('new-jwt-token');
      expect(result?.user.numberOfKids).toBe(2);
    });

    it('should throw InvalidTokenException for invalid refresh token', async () => {
      tokenService.findSessionByRefreshToken.mockResolvedValue(null);

      await expect(service.refresh('invalid-refresh-token')).rejects.toThrow(
        InvalidTokenException,
      );
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      tokenService.deleteSession.mockResolvedValue(true);

      const result = await service.logout('session-1');

      expect(result).toBe(true);
      expect(tokenService.deleteSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('logoutAllDevices', () => {
    it('should logout all devices successfully', async () => {
      tokenService.deleteAllUserSessions.mockResolvedValue(true);

      const result = await service.logoutAllDevices('user-1');

      expect(result).toBe(true);
      expect(tokenService.deleteAllUserSessions).toHaveBeenCalledWith('user-1');
    });
  });
});
