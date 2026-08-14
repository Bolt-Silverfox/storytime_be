import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { PrismaService } from '@/prisma/prisma.service';

export interface JwtPayload {
  userId: string;
  userRole: string;
  email: string;
  expiry: number;
  exp?: number;
  authSessionId?: string;
}

export interface AuthenticatedRequest extends Request {
  authUserData: JwtPayload;
}

export interface OptionalAuthRequest extends Request {
  authUserData?: JwtPayload;
}

@Injectable()
export class AuthSessionGuard implements CanActivate {
  private readonly logger = new Logger(AuthSessionGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();

    if (isOptionalAuth) {
      // Optional auth: attach user data when a valid token is present, but
      // never reject the request. Guests (no/invalid token) pass through with
      // `authUserData` left undefined.
      try {
        await this.validateRequest(request);
      } catch {
        // Swallow auth errors — the handler decides what to do without a user.
      }
      return true;
    }

    return this.validateRequest(request);
  }

  private async validateRequest(request: Request): Promise<boolean> {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('Auth failure: missing or invalid authorization header');
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.split(' ')[1];
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      if (!payload.authSessionId) {
        this.logger.warn('Auth failure: token missing authSessionId claim');
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Check if session exists and is active
      const session = await this.prisma.session.findUnique({
        where: { id: payload.authSessionId },
      });

      if (!session) {
        this.logger.warn(
          `Auth failure: session not found [sessionId=${payload.authSessionId}]`,
        );
        throw new UnauthorizedException('Session invalid or expired');
      }

      if (session.deletedAt !== null || session.isDeleted) {
        this.logger.warn(
          `Auth failure: session is soft-deleted [sessionId=${session.id}]`,
        );
        throw new UnauthorizedException('Session has been revoked');
      }

      if (session.expiresAt < new Date()) {
        this.logger.warn(
          `Auth failure: session expired [sessionId=${session.id}, expiresAt=${session.expiresAt.toISOString()}]`,
        );
        throw new UnauthorizedException('Session has expired');
      }

      // Track last activity for avg-session-time analytics. Throttled to at most
      // one write per 60s per session; fire-and-forget so it never adds latency
      // or fails an otherwise-valid request.
      const ACTIVITY_THROTTLE_MS = 60_000;
      const last = session.lastActivityAt?.getTime() ?? 0;
      if (Date.now() - last > ACTIVITY_THROTTLE_MS) {
        void this.prisma.session
          .update({
            where: { id: session.id },
            data: { lastActivityAt: new Date() },
          })
          .catch(() => undefined);
      }

      this.logger.debug(
        `Auth success [userId=${payload.userId.substring(0, 8)}...]`,
      );
      (request as AuthenticatedRequest).authUserData = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('AuthGuard unexpected error', error);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
