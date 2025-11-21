import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from './auth.guard';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).authUserData as JwtPayload;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.userRole !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}