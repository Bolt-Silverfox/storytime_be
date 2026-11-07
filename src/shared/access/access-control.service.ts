import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtPayload } from '@/shared/guards/auth.guard';

export interface OwnerRef {
  userId?: string | null;
  kidId?: string | null;
}

@Injectable()
export class AccessControlService {
  constructor(private readonly prisma: PrismaService) {}

  private assertId(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException(`Invalid ${label} id`);
    }
  }

  isAdmin(auth: JwtPayload): boolean {
    return auth.userRole === 'admin';
  }

  assertAdmin(auth: JwtPayload): void {
    if (!this.isAdmin(auth)) {
      throw new ForbiddenException('Admins only');
    }
  }

  assertSelfOrAdmin(auth: JwtPayload, userId: string): void {
    this.assertId(userId, 'user');
    if (!this.isAdmin(auth) && auth.userId !== userId) {
      throw new ForbiddenException('You can only access your own data');
    }
  }

  async assertKidAccess(auth: JwtPayload, kidId: string): Promise<void> {
    this.assertId(kidId, 'kid');
    if (this.isAdmin(auth)) return;
    const kid = await this.prisma.kid.findFirst({
      where: { id: kidId, parentId: auth.userId, isDeleted: false },
      select: { id: true },
    });
    if (!kid) {
      throw new ForbiddenException('You can only access your own kids');
    }
  }

  async assertOwner(auth: JwtPayload, owner: OwnerRef): Promise<void> {
    if (this.isAdmin(auth)) return;
    if (owner.kidId) return this.assertKidAccess(auth, owner.kidId);
    if (owner.userId) return this.assertSelfOrAdmin(auth, owner.userId);
    throw new ForbiddenException('You do not have access to this resource');
  }

  resolveUserId(auth: JwtPayload, requested?: string | null): string {
    if (!requested) return auth.userId;
    this.assertSelfOrAdmin(auth, requested);
    return requested;
  }
}
