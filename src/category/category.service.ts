import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto } from './category.dto';

@Injectable()
export class CategoryService {
  private readonly DEFAULT_PLACEHOLDER_IMAGE = 'https://via.placeholder.com/400x300?text=Category+Image';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all categories filtered by age
   * @param age - The age of the active kid profile
   * @returns Array of categories suitable for the given age
   */
  async findAllByAge(age: number): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      where: {
        ageGroups: {
          some: {
            ageGroup: {
              min: { lte: age },
              max: { gte: age },
            },
          },
        },
      },
      include: {
        ageGroups: {
          include: {
            ageGroup: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return categories.map(category => this.formatCategoryResponse(category));
  }

  /**
   * Find all categories (admin only)
   * @returns Array of all categories
   */
  async findAll(): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      include: {
        ageGroups: {
          include: {
            ageGroup: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return categories.map(category => this.formatCategoryResponse(category));
  }

  /**
   * Find a single category by ID
   * @param id - Category ID
   * @returns Category details
   */
  async findOne(id: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        ageGroups: {
          include: {
            ageGroup: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return this.formatCategoryResponse(category);
  }

  /**
   * Create a new category
   * @param createCategoryDto - Category data
   * @returns Created category
   */
  async create(createCategoryDto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const { name, image, description, ageGroupIds } = createCategoryDto;

    // Generate slug from name
    const slug = this.generateSlug(name);

    // Check if slug already exists
    const existingCategory = await this.prisma.category.findUnique({
      where: { slug },
    });

    if (existingCategory) {
      throw new BadRequestException(`Category with slug "${slug}" already exists`);
    }

    // Verify age groups exist
    const ageGroups = await this.prisma.ageGroup.findMany({
      where: { id: { in: ageGroupIds } },
    });

    if (ageGroups.length !== ageGroupIds.length) {
      throw new BadRequestException('One or more age group IDs are invalid');
    }

    const category = await this.prisma.category.create({
      data: {
        name,
        slug,
        image,
        description,
        ageGroups: {
          create: ageGroupIds.map(ageGroupId => ({
            ageGroup: {
              connect: { id: ageGroupId },
            },
          })),
        },
      },
      include: {
        ageGroups: {
          include: {
            ageGroup: true,
          },
        },
      },
    });

    return this.formatCategoryResponse(category);
  }

  /**
   * Update a category
   * @param id - Category ID
   * @param updateCategoryDto - Updated category data
   * @returns Updated category
   */
  async update(id: string, updateCategoryDto: UpdateCategoryDto): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    const { name, image, description, ageGroupIds } = updateCategoryDto;

    // Generate new slug if name is being updated
    let slug = category.slug;
    if (name && name !== category.name) {
      slug = this.generateSlug(name);

      // Check if new slug already exists
      const existingCategory = await this.prisma.category.findUnique({
        where: { slug },
      });

      if (existingCategory && existingCategory.id !== id) {
        throw new BadRequestException(`Category with slug "${slug}" already exists`);
      }
    }

    // If ageGroupIds are provided, verify they exist
    if (ageGroupIds) {
      const ageGroups = await this.prisma.ageGroup.findMany({
        where: { id: { in: ageGroupIds } },
      });

      if (ageGroups.length !== ageGroupIds.length) {
        throw new BadRequestException('One or more age group IDs are invalid');
      }
    }

    const updatedCategory = await this.prisma.category.update({
      where: { id },
      data: {
        ...(name && { name, slug }),
        ...(image !== undefined && { image}),
        ...(description !== undefined && { description }),
        ...(ageGroupIds && {
          ageGroups: {
            deleteMany: {},
            create: ageGroupIds.map(ageGroupId => ({
              ageGroup: {
                connect: { id: ageGroupId },
              },
            })),
          },
        }),
      },
      include: {
        ageGroups: {
          include: {
            ageGroup: true,
          },
        },
      },
    });

    return this.formatCategoryResponse(updatedCategory);
  }

  /**
   * Delete a category
   * @param id - Category ID
   */
  async remove(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    await this.prisma.category.delete({
      where: { id },
    });
  }

  /**
   * Format category response with default placeholder image
   * @param category - Raw category data from database
   * @returns Formatted category response
   */
  private formatCategoryResponse(category: any): CategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      image: category.image || this.DEFAULT_PLACEHOLDER_IMAGE,
      description: category.description,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }

  /**
   * Generate URL-friendly slug from name
   * @param name - Category name
   * @returns Slug
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-'); // Replace multiple hyphens with single hyphen
  }
}
