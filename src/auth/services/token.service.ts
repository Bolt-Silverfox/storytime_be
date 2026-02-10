import {
  Injectable,
  Inject,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserDto } from '../dto/auth.dto';
import * as crypto from 'crypto';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';

const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

export interface TokenPayload {
  id: string;
  userId: string;
  email: string;
  userRole: string;
  expiry: number;
  authSessionId: string;
}

export interface TokenPair {
  jwt: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
  ) {}

  /**
   * Create a new session and generate JWT + refresh token pair
   */
  async createTokenPair(user: UserDto): Promise<TokenPair> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_IN_DAYS);
    const refreshToken = this.generateRefreshToken();

    const session = await this.authRepository.createSession({
      userId: user.id,
      token: this.hashToken(refreshToken),
      expiresAt,
    });

    const jwt = this.generateJwt(user, session.id);
    return { jwt, refreshToken };
  }

  /**
   * Generate a JWT for the given user and session
   */
  generateJwt(user: UserDto, sessionId: string): string {
    const expiresIn = 3600; // 1 hour
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiryTimestamp = issuedAt + expiresIn;

    try {
      return this.jwtService.sign({
        id: user.id,
        userId: user.id,
        email: user.email,
        userRole: user.role,
        expiry: expiryTimestamp,
        authSessionId: sessionId,
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(
          `Error signing token: ${error.message}`,
        );
      }
      this.logger.error('Unknown error signing token', error);
      throw new InternalServerErrorException(
        'Unknown error occurred while signing token',
      );
    }
  }

  /**
   * Generate a cryptographically secure refresh token
   */
  generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Hash a token using SHA-256 for secure storage
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Verify a JWT and return the payload
   */
  verifyJwt(token: string): TokenPayload {
    return this.jwtService.verify<TokenPayload>(token);
  }

  /**
   * Decode a JWT without verification (for inspection only)
   */
  decodeJwt(token: string): TokenPayload | null {
    return this.jwtService.decode(token);
  }

  /**
   * Find a session by hashed refresh token
   * Includes user with kid count to avoid separate query
   */
  async findSessionByRefreshToken(refreshToken: string) {
    return this.authRepository.findSessionByToken(this.hashToken(refreshToken));
  }

  /**
   * Delete a session by ID
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const session = await this.authRepository.findSessionById(sessionId);
      if (!session) return false;

      await this.authRepository.deleteSession(sessionId);
      return true;
    } catch (error) {
      this.logger.error('Error deleting session:', error);
      return false;
    }
  }

  /**
   * Delete all sessions for a user
   */
  async deleteAllUserSessions(userId: string): Promise<boolean> {
    try {
      await this.authRepository.deleteAllUserSessions(userId);
      return true;
    } catch (error) {
      this.logger.error('Error deleting all user sessions:', error);
      return false;
    }
  }

  /**
   * Delete all sessions for a user except the specified one
   */
  async deleteOtherSessions(
    userId: string,
    exceptSessionId: string,
  ): Promise<void> {
    await this.authRepository.deleteOtherSessions(userId, exceptSessionId);
  }
}
