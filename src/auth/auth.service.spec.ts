import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { AUTH_REPOSITORY } from './repositories';
import { TokenService } from './services/token.service';
import { Role } from '@prisma/client';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let authRepository: { findUserByEmailWithRelations: jest.Mock };
  let tokenService: jest.Mocked<
    Pick<
      TokenService,
      | 'createTokenPair'
      | 'findSessionByRefreshToken'
      | 'generateJwt'
      | 'deleteSession'
      | 'deleteAllUserSessions'
    >
  >;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'hashed_password',
    isEmailVerified: true,
    role: Role.parent,
    profile: null,
    avatar: null,
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

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
        { provide: TokenService, useValue: mockTokenService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    authRepository = module.get(AUTH_REPOSITORY);
    tokenService = module.get(TokenService);
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      authRepository.findUserByEmailWithRelations.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
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
      expect(result?.user.numberOfKids).toBe(2);
      expect(authRepository.findUserByEmailWithRelations).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should throw BadRequestException for unknown email', async () => {
      authRepository.findUserByEmailWithRelations.mockResolvedValue(null);

      await expect(
        service.login({ email: 'wrong@example.com', password: 'password123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid password', async () => {
      authRepository.findUserByEmailWithRelations.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for unverified email', async () => {
      authRepository.findUserByEmailWithRelations.mockResolvedValue({
        ...mockUser,
        isEmailVerified: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refresh', () => {
    it('should refresh token successfully with valid refresh token', async () => {
      const session = {
        id: 'session-1',
        user: { ...mockUser },
      };
      tokenService.findSessionByRefreshToken.mockResolvedValue(session);
      tokenService.generateJwt.mockReturnValue('new-jwt-token');

      const result = await service.refresh('valid-refresh-token');

      expect(result).toBeDefined();
      expect(result?.jwt).toBe('new-jwt-token');
      expect(result?.user.numberOfKids).toBe(2);
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      tokenService.findSessionByRefreshToken.mockResolvedValue(null);

      await expect(service.refresh('invalid-refresh-token')).rejects.toThrow(
        UnauthorizedException,
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
