import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticatedRequest } from './auth.guard';

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
