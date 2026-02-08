import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from './auth.guard';

/** Request with authenticated user data attached */
interface AuthenticatedRequest extends Request {
  authUserData?: JwtPayload;
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authUserData;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.userRole !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
