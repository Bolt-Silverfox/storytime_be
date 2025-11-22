import { PartialType } from '@nestjs/swagger';

export class CreateAgeDto {}
export class UpdateAgeDto extends PartialType(CreateAgeDto) {}
