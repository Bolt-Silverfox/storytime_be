import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenService, TokenPayload } from './token.service';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';
import { UserDto } from '../dto/auth.dto';
import { Role, OnboardingStatus } from '@prisma/client';
import * as crypto from 'crypto';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: jest.Mocked<JwtService>;
  let authRepository: jest.Mocked<IAuthRepository>;

  const mockUser: UserDto = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.parent,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    profile: null,
    numberOfKids: 2,
  };

  const mockSession = {
    id: 'session-1',
    userId: 'user-1',
    token: 'hashed-refresh-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  };

  const mockSessionWithUser = {
    ...mockSession,
    user: {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: 'hashed_password',
      isEmailVerified: true,
      role: Role.parent,
      onboardingStatus: OnboardingStatus.profile_setup,
      googleId: null,
      appleId: null,
      avatarId: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      _count: { kids: 2 },
    },
  };

  beforeEach(async () => {
    const mockJwtService: Partial<jest.Mocked<JwtService>> = {
      sign: jest.fn().mockReturnValue('signed-jwt-token'),
      verify: jest.fn(),
      decode: jest.fn(),
    };

    const mockAuthRepository: Partial<jest.Mocked<IAuthRepository>> = {
      createSession: jest.fn(),
      findSessionByToken: jest.fn(),
      findSessionById: jest.fn(),
      deleteSession: jest.fn(),
      deleteAllUserSessions: jest.fn(),
      deleteOtherSessions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: AUTH_REPOSITORY, useValue: mockAuthRepository },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
    jwtService = module.get(JwtService);
    authRepository = module.get(AUTH_REPOSITORY);
  });

  describe('createTokenPair', () => {
    it('should create a session and return jwt + refresh token pair', async () => {
      // Arrange
      authRepository.createSession.mockResolvedValue(mockSession as any);

      // Act
      const result = await service.createTokenPair(mockUser);

      // Assert
      expect(result).toBeDefined();
      expect(result.jwt).toBe('signed-jwt-token');
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.refreshToken).toBe('string');
      expect(authRepository.createSession).toHaveBeenCalledWith({
        userId: 'user-1',
        token: expect.any(String),
        expiresAt: expect.any(Date),
      });
    });

    it('should create a session with 7-day expiry', async () => {
      // Arrange
      authRepository.createSession.mockResolvedValue(mockSession as any);
      const now = Date.now();

      // Act
      await service.createTokenPair(mockUser);

      // Assert
      const sessionData = authRepository.createSession.mock.calls[0][0];
      const expiresAt = sessionData.expiresAt.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      // Allow 5 seconds tolerance
      expect(expiresAt).toBeGreaterThanOrEqual(now + sevenDaysMs - 5000);
      expect(expiresAt).toBeLessThanOrEqual(now + sevenDaysMs + 5000);
    });
  });

  describe('generateJwt', () => {
    it('should generate a JWT with correct payload', () => {
      // Act
      const result = service.generateJwt(mockUser, 'session-1');

      // Assert
      expect(result).toBe('signed-jwt-token');
      expect(jwtService.sign).toHaveBeenCalledWith({
        id: 'user-1',
        userId: 'user-1',
        email: 'test@example.com',
        userRole: Role.parent,
        expiry: expect.any(Number),
        authSessionId: 'session-1',
      });
    });

    it('should set expiry to 1 hour from now', () => {
      // Arrange
      const now = Math.floor(Date.now() / 1000);

      // Act
      service.generateJwt(mockUser, 'session-1');

      // Assert
      const payload = jwtService.sign.mock.calls[0][0] as TokenPayload;
      expect(payload.expiry).toBeGreaterThanOrEqual(now + 3600 - 2);
      expect(payload.expiry).toBeLessThanOrEqual(now + 3600 + 2);
    });

    it('should throw InternalServerErrorException when signing fails', () => {
      // Arrange
      jwtService.sign.mockImplementation(() => {
        throw new Error('Signing failed');
      });

      // Act & Assert
      expect(() => service.generateJwt(mockUser, 'session-1')).toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException for non-Error signing failures', () => {
      // Arrange
      jwtService.sign.mockImplementation(() => {
        throw 'unknown error';
      });

      // Act & Assert
      expect(() => service.generateJwt(mockUser, 'session-1')).toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('should return a hex-encoded string', () => {
      // Act
      const token = service.generateRefreshToken();

      // Assert
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it('should return a 128-character string (64 bytes as hex)', () => {
      // Act
      const token = service.generateRefreshToken();

      // Assert
      expect(token.length).toBe(128);
    });

    it('should generate unique tokens on each call', () => {
      // Act
      const token1 = service.generateRefreshToken();
      const token2 = service.generateRefreshToken();

      // Assert
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashToken', () => {
    it('should return a SHA-256 hash of the token', () => {
      // Arrange
      const token = 'test-token';
      const expectedHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      // Act
      const result = service.hashToken(token);

      // Assert
      expect(result).toBe(expectedHash);
    });

    it('should produce consistent hashes for the same input', () => {
      // Act
      const hash1 = service.hashToken('same-token');
      const hash2 = service.hashToken('same-token');

      // Assert
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      // Act
      const hash1 = service.hashToken('token-a');
      const hash2 = service.hashToken('token-b');

      // Assert
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyJwt', () => {
    it('should return decoded payload for a valid JWT', () => {
      // Arrange
      const mockPayload: TokenPayload = {
        id: 'user-1',
        userId: 'user-1',
        email: 'test@example.com',
        userRole: Role.parent,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        authSessionId: 'session-1',
      };
      jwtService.verify.mockReturnValue(mockPayload);

      // Act
      const result = service.verifyJwt('valid-jwt-token');

      // Assert
      expect(result).toEqual(mockPayload);
      expect(jwtService.verify).toHaveBeenCalledWith('valid-jwt-token');
    });

    it('should throw when JWT is invalid', () => {
      // Arrange
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      // Act & Assert
      expect(() => service.verifyJwt('invalid-jwt')).toThrow();
    });
  });

  describe('decodeJwt', () => {
    it('should decode a JWT without verification', () => {
      // Arrange
      const mockPayload: TokenPayload = {
        id: 'user-1',
        userId: 'user-1',
        email: 'test@example.com',
        userRole: Role.parent,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        authSessionId: 'session-1',
      };
      jwtService.decode.mockReturnValue(mockPayload);

      // Act
      const result = service.decodeJwt('some-jwt-token');

      // Assert
      expect(result).toEqual(mockPayload);
      expect(jwtService.decode).toHaveBeenCalledWith('some-jwt-token');
    });

    it('should return null for an undecodable token', () => {
      // Arrange
      jwtService.decode.mockReturnValue(null);

      // Act
      const result = service.decodeJwt('garbage-token');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findSessionByRefreshToken', () => {
    it('should find session by hashed refresh token', async () => {
      // Arrange
      authRepository.findSessionByToken.mockResolvedValue(
        mockSessionWithUser as any,
      );

      // Act
      const result = await service.findSessionByRefreshToken('raw-refresh-token');

      // Assert
      expect(result).toEqual(mockSessionWithUser);
      const expectedHash = crypto
        .createHash('sha256')
        .update('raw-refresh-token')
        .digest('hex');
      expect(authRepository.findSessionByToken).toHaveBeenCalledWith(
        expectedHash,
      );
    });

    it('should return null when session is not found', async () => {
      // Arrange
      authRepository.findSessionByToken.mockResolvedValue(null);

      // Act
      const result = await service.findSessionByRefreshToken('unknown-token');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('should delete session and return true when session exists', async () => {
      // Arrange
      authRepository.findSessionById.mockResolvedValue(mockSession as any);
      authRepository.deleteSession.mockResolvedValue(undefined);

      // Act
      const result = await service.deleteSession('session-1');

      // Assert
      expect(result).toBe(true);
      expect(authRepository.findSessionById).toHaveBeenCalledWith('session-1');
      expect(authRepository.deleteSession).toHaveBeenCalledWith('session-1');
    });

    it('should return false when session does not exist', async () => {
      // Arrange
      authRepository.findSessionById.mockResolvedValue(null);

      // Act
      const result = await service.deleteSession('nonexistent-session');

      // Assert
      expect(result).toBe(false);
      expect(authRepository.deleteSession).not.toHaveBeenCalled();
    });

    it('should return false when an error occurs', async () => {
      // Arrange
      authRepository.findSessionById.mockRejectedValue(
        new Error('Database error'),
      );

      // Act
      const result = await service.deleteSession('session-1');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('deleteAllUserSessions', () => {
    it('should delete all sessions and return true', async () => {
      // Arrange
      authRepository.deleteAllUserSessions.mockResolvedValue(undefined);

      // Act
      const result = await service.deleteAllUserSessions('user-1');

      // Assert
      expect(result).toBe(true);
      expect(authRepository.deleteAllUserSessions).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('should return false when an error occurs', async () => {
      // Arrange
      authRepository.deleteAllUserSessions.mockRejectedValue(
        new Error('Database error'),
      );

      // Act
      const result = await service.deleteAllUserSessions('user-1');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('deleteOtherSessions', () => {
    it('should delete other sessions except the specified one', async () => {
      // Arrange
      authRepository.deleteOtherSessions.mockResolvedValue(undefined);

      // Act
      await service.deleteOtherSessions('user-1', 'keep-session-1');

      // Assert
      expect(authRepository.deleteOtherSessions).toHaveBeenCalledWith(
        'user-1',
        'keep-session-1',
      );
    });
  });
});
