import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';

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

/**
 * Verifies and decodes a JWT token
 * @param token The JWT token to verify
 * @param configService The ConfigService instance
 * @returns The decoded token payload or null if invalid
 */
export function checkJwtToken(
  token: string,
  configService: ConfigService,
): JwtPayload | null {
  const jwtSecret = configService.get<string>('SECRET') || 'your-secret-key';
  const decoded = jwt.verify(token, jwtSecret) as JwtPayload;

  if (!decoded.authSessionId) {
    throw new Error('Invalid token');
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (decoded?.exp && decoded?.exp < currentTimestamp) {
    throw new Error('Invalid or expired token');
  }
  return decoded;
}

@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    return this.validateRequest(request);
  }

  private validateRequest(request: Request): boolean {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authHeader.split(' ')[1];
    try {
      const payload = checkJwtToken(token, this.configService);
      if (!payload) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      (request as AuthenticatedRequest).authUserData = payload;
      return true;
    } catch (error) {
      throw new UnauthorizedException(error.message);
    }
  }
}
