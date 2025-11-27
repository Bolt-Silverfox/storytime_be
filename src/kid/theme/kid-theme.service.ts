import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class KidThemeService {
  constructor(private prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  async getTheme(kidId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);
    return this.prisma.kid.findUnique({
      where: { id: kidId },
      select: { theme: true },
    });
  }

  async updateTheme(kidId: string, theme: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);
    return this.prisma.kid.update({
      where: { id: kidId },
      data: { theme },
    });
  }
}

