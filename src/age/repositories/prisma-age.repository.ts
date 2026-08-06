import { Injectable } from '@nestjs/common';
import { AgeGroup } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateAgeDto, UpdateAgeDto } from '../dto/age.dto';
import { IAgeRepository } from './age.repository.interface';

@Injectable()
export class PrismaAgeRepository implements IAgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<AgeGroup[]> {
    return this.prisma.ageGroup.findMany({
      where: { isDeleted: false },
      orderBy: { min: 'asc' },
    });
  }

  async findById(id: string): Promise<AgeGroup | null> {
    return this.prisma.ageGroup.findUnique({
      where: { id, isDeleted: false },
    });
  }

  async findByIdIncludingDeleted(id: string): Promise<AgeGroup | null> {
    return this.prisma.ageGroup.findUnique({
      where: { id },
    });
  }

  async findOverlapping(
    min: number,
    max: number,
    excludeId?: string,
  ): Promise<AgeGroup | null> {
    return this.prisma.ageGroup.findFirst({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        isDeleted: false,
        OR: [{ min: { lte: max }, max: { gte: min } }],
      },
    });
  }

  async findByAgeValue(age: number): Promise<AgeGroup | null> {
    return this.prisma.ageGroup.findFirst({
      where: {
        min: { lte: age },
        max: { gte: age },
        isDeleted: false,
      },
    });
  }

  async create(data: CreateAgeDto): Promise<AgeGroup> {
    return this.prisma.ageGroup.create({ data });
  }

  async update(id: string, data: UpdateAgeDto): Promise<AgeGroup> {
    return this.prisma.ageGroup.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<AgeGroup> {
    return this.prisma.ageGroup.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
  }

  async hardDelete(id: string): Promise<AgeGroup> {
    return this.prisma.ageGroup.delete({ where: { id } });
  }

  async restore(id: string): Promise<AgeGroup> {
    return this.prisma.ageGroup.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }
}
