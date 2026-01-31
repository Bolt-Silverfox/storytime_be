import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateAgeDto, UpdateAgeDto } from './dto/age.dto';
import { IAgeRepository, AGE_REPOSITORY } from './repositories';

@Injectable()
export class AgeService {
  constructor(
    @Inject(AGE_REPOSITORY) private readonly ageRepository: IAgeRepository,
  ) {}

  /* ----------------------------------------
   * VALIDATION HELPERS
   ---------------------------------------- */

  private validateRange(min: number, max: number) {
    if (min >= max) {
      throw new BadRequestException(
        'Minimum age must be less than maximum age',
      );
    }
  }

  private async validateNoOverlap(
    min: number,
    max: number,
    excludeId?: string,
  ) {
    const conflict = await this.ageRepository.findOverlapping(
      min,
      max,
      excludeId,
    );

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
    return this.ageRepository.findAll();
  }

  async findOne(id: string) {
    const ageGroup = await this.ageRepository.findById(id);
    if (!ageGroup) throw new NotFoundException('Age group not found');
    return ageGroup;
  }

  async create(data: CreateAgeDto) {
    this.validateRange(data.min, data.max);
    await this.validateNoOverlap(data.min, data.max);

    return this.ageRepository.create(data);
  }

  async update(id: string, data: UpdateAgeDto) {
    const exists = await this.ageRepository.findById(id);
    if (!exists) throw new NotFoundException('Age group not found');

    const min = data.min ?? exists.min;
    const max = data.max ?? exists.max;

    this.validateRange(min, max);
    await this.validateNoOverlap(min, max, id);

    return this.ageRepository.update(id, data);
  }

  async delete(id: string, permanent: boolean = false) {
    const exists = await this.ageRepository.findById(id);
    if (!exists) throw new NotFoundException('Age group not found');

    if (permanent) {
      return this.ageRepository.hardDelete(id);
    } else {
      return this.ageRepository.softDelete(id);
    }
  }

  async undoDelete(id: string) {
    const ageGroup = await this.ageRepository.findByIdIncludingDeleted(id);
    if (!ageGroup) throw new NotFoundException('Age group not found');
    if (!ageGroup.isDeleted)
      throw new BadRequestException('Age group is not deleted');

    return this.ageRepository.restore(id);
  }

  /* ----------------------------------------
   * EXTRA FEATURE: GET GROUP FOR A CHILD'S AGE
   ---------------------------------------- */

  async findGroupForAge(age: number) {
    const group = await this.ageRepository.findByAgeValue(age);

    if (!group) {
      throw new NotFoundException(`No age group found for age ${age}`);
    }

    return group;
  }
}
