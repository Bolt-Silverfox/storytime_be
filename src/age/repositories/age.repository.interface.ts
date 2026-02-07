import { AgeGroup } from '@prisma/client';
import { CreateAgeDto, UpdateAgeDto } from '../dto/age.dto';

export interface IAgeRepository {
  findAll(): Promise<AgeGroup[]>;
  findById(id: string): Promise<AgeGroup | null>;
  findByIdIncludingDeleted(id: string): Promise<AgeGroup | null>;
  findOverlapping(min: number, max: number, excludeId?: string): Promise<AgeGroup | null>;
  findByAgeValue(age: number): Promise<AgeGroup | null>;
  create(data: CreateAgeDto): Promise<AgeGroup>;
  update(id: string, data: UpdateAgeDto): Promise<AgeGroup>;
  softDelete(id: string): Promise<AgeGroup>;
  hardDelete(id: string): Promise<AgeGroup>;
  restore(id: string): Promise<AgeGroup>;
}

export const AGE_REPOSITORY = Symbol('AGE_REPOSITORY');
