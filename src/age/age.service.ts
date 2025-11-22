import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAgeDto, UpdateAgeDto } from './age.dto';

@Injectable()
export class AgeService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.ageGroup.findMany();
  }

  async create(data: CreateAgeDto) {
    return this.prisma.ageGroup.create({ data });
  }

  async update(id: string, data: UpdateAgeDto) {
    const exists = await this.prisma.ageGroup.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Age group not found');
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
}
