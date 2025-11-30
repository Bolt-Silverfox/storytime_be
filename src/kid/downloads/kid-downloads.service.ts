import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class KidDownloadsService {
  constructor(private prisma: PrismaService) {}

  // Reusable validator
  private async validateKidOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({ where: { id: kidId } });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    if (kid.parentId !== parentId) {
      throw new ForbiddenException('You are not allowed to access this kid');
    }
  }

  // List downloads
  async list(kidId: string, parentId: string) {
    await this.validateKidOwnership(kidId, parentId);

    return this.prisma.kidDownload.findMany({
      where: { kidId },
      include: { story: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Add download
  async add(kidId: string, storyId: string, parentId: string) {
    await this.validateKidOwnership(kidId, parentId);

    // Check if story exists
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story) throw new NotFoundException('Story does not exist');

    // Check if already downloaded
    const existing = await this.prisma.kidDownload.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });

    if (existing) {
      throw new BadRequestException('Story already downloaded for this kid');
    }

    return this.prisma.kidDownload.create({
      data: { kidId, storyId },
    });
  }

  // Remove download
  async remove(kidId: string, storyId: string, parentId: string) {
    await this.validateKidOwnership(kidId, parentId);

    const existing = await this.prisma.kidDownload.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });

    if (!existing) {
      throw new NotFoundException('This story is not downloaded by the kid');
    }

    return this.prisma.kidDownload.delete({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }
}
