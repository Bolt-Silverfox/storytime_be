import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

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
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

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