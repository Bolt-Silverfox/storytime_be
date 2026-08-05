import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../shared/guards/auth.guard';

@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.query?.token;

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      if (!payload.authSessionId) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Ensure the session is still active (not revoked or expired)
      const session = await this.prisma.session.findUnique({
        where: { id: payload.authSessionId },
      });

      if (!session || session.isDeleted || session.expiresAt < new Date()) {
        throw new UnauthorizedException('Session invalid or expired');
      }

      const user = await this.prisma.user.findFirst({
        where: { id: payload.userId, isDeleted: false },
      });

      if (!user || user.role !== Role.admin) {
        throw new UnauthorizedException('Admin access required');
      }

      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
