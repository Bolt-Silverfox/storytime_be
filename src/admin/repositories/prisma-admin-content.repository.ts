import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  IAdminContentRepository,
  CategorySeedInput,
  ThemeSeedInput,
  AgeGroupSeedInput,
  AvatarSeedInput,
  ContentBreakdownRow,
} from './admin-content.repository.interface';

@Injectable()
export class PrismaAdminContentRepository implements IAdminContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  countCategories(): Promise<number> {
    return this.prisma.category.count({ where: { isDeleted: false } });
  }

  countThemes(): Promise<number> {
    return this.prisma.theme.count({ where: { isDeleted: false } });
  }

  findCategoryBreakdown(): Promise<ContentBreakdownRow[]> {
    return this.prisma.category.findMany({
      where: { isDeleted: false },
      select: {
        name: true,
        _count: {
          select: { stories: true },
        },
      },
    });
  }

  findThemeBreakdown(): Promise<ContentBreakdownRow[]> {
    return this.prisma.theme.findMany({
      where: { isDeleted: false },
      select: {
        name: true,
        _count: {
          select: { stories: true },
        },
      },
    });
  }

  // ===== AdminService.seedDatabase variant (find-first) =====

  async seedCategoryByFind(category: CategorySeedInput): Promise<void> {
    const existingCategory = await this.prisma.category.findFirst({
      where: { name: category.name },
    });

    if (existingCategory) {
      await this.prisma.category.update({
        where: { id: existingCategory.id },
        data: {
          image: category.image,
          description: category.description,
          isDeleted: false,
          deletedAt: null,
        },
      });
    } else {
      await this.prisma.category.create({
        data: {
          name: category.name,
          image: category.image,
          description: category.description,
        },
      });
    }
  }

  async seedSystemAvatarWithFlags(avatar: AvatarSeedInput): Promise<void> {
    const existingAvatar = await this.prisma.avatar.findFirst({
      where: {
        name: avatar.name,
        isSystemAvatar: true,
      },
    });

    if (existingAvatar) {
      await this.prisma.avatar.update({
        where: { id: existingAvatar.id },
        data: {
          url: avatar.url,
          isSystemAvatar: true,
          isDeleted: false,
          deletedAt: null,
        },
      });
    } else {
      await this.prisma.avatar.create({
        data: {
          name: avatar.name,
          url: avatar.url,
          isSystemAvatar: true,
          isDeleted: false,
          deletedAt: null,
        },
      });
    }
  }

  // ===== AdminSystemService.seedDatabase variant (upsert) =====

  async upsertCategorySeed(category: CategorySeedInput): Promise<void> {
    await this.prisma.category
      .upsert({
        where: { id: category.name }, // Or name if unique
        update: {
          image: category.image,
          description: category.description,
          isDeleted: false,
          deletedAt: null,
        },
        create: {
          name: category.name,
          image: category.image,
          description: category.description,
        },
      })
      .catch(async () => {
        // Fallback if upsert by id fails because name is unique
        const existing = await this.prisma.category.findFirst({
          where: { name: category.name },
        });
        if (existing) {
          return this.prisma.category.update({
            where: { id: existing.id },
            data: {
              image: category.image,
              description: category.description,
              isDeleted: false,
              deletedAt: null,
            },
          });
        }
        return this.prisma.category.create({
          data: {
            name: category.name,
            image: category.image,
            description: category.description,
          },
        });
      });
  }

  async seedSystemAvatar(avatar: AvatarSeedInput): Promise<void> {
    const existing = await this.prisma.avatar.findFirst({
      where: { name: avatar.name, isSystemAvatar: true },
    });
    if (existing) {
      await this.prisma.avatar.update({
        where: { id: existing.id },
        data: {
          url: avatar.url,
          isSystemAvatar: true,
          isDeleted: false,
          deletedAt: null,
        },
      });
    } else {
      await this.prisma.avatar.create({
        data: {
          name: avatar.name,
          url: avatar.url,
          isSystemAvatar: true,
        },
      });
    }
  }

  // ===== Shared byte-identical seeders =====

  async seedTheme(theme: ThemeSeedInput): Promise<void> {
    const existingTheme = await this.prisma.theme.findFirst({
      where: { name: theme.name },
    });

    if (existingTheme) {
      await this.prisma.theme.update({
        where: { id: existingTheme.id },
        data: {
          image: theme.image,
          description: theme.description,
          isDeleted: false,
          deletedAt: null,
        },
      });
    } else {
      await this.prisma.theme.create({
        data: {
          name: theme.name,
          image: theme.image,
          description: theme.description,
        },
      });
    }
  }

  async seedAgeGroup(ageGroup: AgeGroupSeedInput): Promise<void> {
    const existingAgeGroup = await this.prisma.ageGroup.findFirst({
      where: { name: ageGroup.name },
    });

    if (existingAgeGroup) {
      await this.prisma.ageGroup.update({
        where: { id: existingAgeGroup.id },
        data: {
          min: ageGroup.min,
          max: ageGroup.max,
          isDeleted: false,
          deletedAt: null,
        },
      });
    } else {
      await this.prisma.ageGroup.create({
        data: {
          name: ageGroup.name,
          min: ageGroup.min,
          max: ageGroup.max,
        },
      });
    }
  }
}
