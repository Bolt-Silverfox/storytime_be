import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAgeDto, UpdateAgeDto } from './age.dto';

@Injectable()
export class AgeService {
  constructor(private prisma: PrismaService) {}

  /* ----------------------------------------
   * VALIDATION HELPERS
   ---------------------------------------- */

  // 1. Check min < max
  private validateRange(min: number, max: number) {
    if (min >= max) {
      throw new BadRequestException(
        'Minimum age must be less than maximum age',
      );
    }
  }

  // 2. Check overlapping age groups
  private async validateNoOverlap(
    min: number,
    max: number,
    excludeId?: string,
  ) {
    const conflict = await this.prisma.ageGroup.findFirst({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        OR: [
          // A overlaps B if A.min <= B.max AND A.max >= B.min
          { min: { lte: max }, max: { gte: min } },
        ],
      },
    });

    if (conflict) {
      throw new BadRequestException(
        `Age group overlaps with existing group: ${conflict.name}`,
      );
    }
  }

  /* ----------------------------------------
   * CRUD OPERATIONS
   ---------------------------------------- */

  async findAll() {
    return this.prisma.ageGroup.findMany({
      orderBy: { min: 'asc' },
    });
  }

  async findOne(id: string) {
    const ageGroup = await this.prisma.ageGroup.findUnique({ where: { id } });
    if (!ageGroup) throw new NotFoundException('Age group not found');
    return ageGroup;
  }

  async create(data: CreateAgeDto) {
    this.validateRange(data.min, data.max);
    await this.validateNoOverlap(data.min, data.max);

    return this.prisma.ageGroup.create({ data });
  }

  async update(id: string, data: UpdateAgeDto) {
    const exists = await this.prisma.ageGroup.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Age group not found');

    const min = data.min ?? exists.min;
    const max = data.max ?? exists.max;

    this.validateRange(min, max);
    await this.validateNoOverlap(min, max, id);

    return this.prisma.ageGroup.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    const exists = await this.prisma.ageGroup.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Age group not found');

    return this.prisma.ageGroup.delete({ where: { id } });
  }

  /* ----------------------------------------
   * EXTRA FEATURE: GET GROUP FOR A CHILD'S AGE
   ---------------------------------------- */

  async findGroupForAge(age: number) {
    const group = await this.prisma.ageGroup.findFirst({
      where: {
        min: { lte: age },
        max: { gte: age },
      },
    });

    if (!group) {
      throw new NotFoundException(`No age group found for age ${age}`);
    }

    return group;
  }
}
