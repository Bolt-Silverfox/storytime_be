import { PartialType } from '@nestjs/swagger';

export class CreateAgeDto {
  name: string;
  min: number;
  max: number;
}

export class UpdateAgeDto extends PartialType(CreateAgeDto) {}
