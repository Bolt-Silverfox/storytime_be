import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
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

@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService
  ) {}

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
      const payload = this.jwtService.verify<JwtPayload>(token);
      if (!payload.authSessionId) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      (request as AuthenticatedRequest).authUserData = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
}
      throw new UnauthorizedException(error.message);
    }
  }
}