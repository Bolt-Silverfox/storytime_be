import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KidFavoritesService {
  constructor(private prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  async addFavorite(kidId: string, storyId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    return this.prisma.favorite.create({
      data: {
        kidId,
        storyId,
      },
    });
  }

  async removeFavorite(kidId: string, storyId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    return this.prisma.favorite.deleteMany({
      where: { kidId, storyId },
    });
  }

  async listFavorites(kidId: string, parentId: string) {
    await this.assertOwnership(kidId, parentId);

    return this.prisma.favorite.findMany({
      where: { kidId },
      include: { story: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
