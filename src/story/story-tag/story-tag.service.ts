import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateStoryTagDto } from './dto/create-story-tag.dto';
import { UpdateStoryTagDto } from './dto/update-story-tag.dto';
import { Prisma } from '@prisma/client';

function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class StoryTagService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStoryTagDto) {
    const slug = dto.slug ?? toSlug(dto.name);

    try {
      const tag = await this.prisma.storyTag.create({
        data: {
          name: dto.name.trim(),
          slug,
        },
      });

      return tag;
    } catch (error) {
      // Unique constraint on name or slug
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'A tag with this name or slug already exists',
        );
      }

      throw error;
    }
  }

  async findAll() {
    return this.prisma.storyTag.findMany({
      where: { isDeleted: false },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const tag = await this.prisma.storyTag.findFirst({
      where: { id, isDeleted: false },
    });

    if (!tag) {
      throw new NotFoundException('Story tag not found');
    }

    return tag;
  }

  async update(id: string, dto: UpdateStoryTagDto) {
    await this.ensureExists(id);

    const data: Prisma.StoryTagUpdateInput = {};

    if (dto.name) {
      data.name = dto.name.trim();
      data.slug = dto.slug ?? toSlug(dto.name);
    } else if (dto.slug) {
      data.slug = dto.slug;
    }

    try {
      return await this.prisma.storyTag.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'A tag with this name or slug already exists',
        );
      }
      throw error;
    }
  }

  async softDelete(id: string) {
    await this.ensureExists(id);

    return this.prisma.storyTag.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.storyTag.findFirst({
      where: { id, isDeleted: false },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Story tag not found');
    }
  }
}
