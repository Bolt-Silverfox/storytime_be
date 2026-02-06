import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '@/prisma/prisma.service';
import { UserDto } from '../dto/auth.dto';
import * as crypto from 'crypto';

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
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Create a new session and generate JWT + refresh token pair
   */
  async createTokenPair(user: UserDto): Promise<TokenPair> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_IN_DAYS);
    const refreshToken = this.generateRefreshToken();

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        token: this.hashToken(refreshToken),
        expiresAt,
      },
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
        throw new Error(`Error signing token: ${error.message}`);
      }
      this.logger.error('Unknown error signing token', error);
      throw new Error('Unknown error occurred while signing token');
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
    return this.jwtService.decode(token) as TokenPayload | null;
  }

  /**
   * Find a session by hashed refresh token
   * Includes user with kid count to avoid separate query
   */
  async findSessionByRefreshToken(refreshToken: string) {
    return this.prisma.session.findUnique({
      where: { token: this.hashToken(refreshToken) },
      include: {
        user: {
          include: {
            _count: { select: { kids: true } },
          },
        },
      },
    });
  }

  /**
   * Delete a session by ID
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (!session) return false;

      await this.prisma.session.delete({ where: { id: sessionId } });
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
      await this.prisma.session.deleteMany({ where: { userId } });
      return true;
    } catch (error) {
      this.logger.error('Error deleting all user sessions:', error);
      return false;
    }
  }

  /**
   * Delete all sessions for a user except the specified one
   */
  async deleteOtherSessions(userId: string, exceptSessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        userId,
        id: { not: exceptSessionId },
      },
    });
  }
}
