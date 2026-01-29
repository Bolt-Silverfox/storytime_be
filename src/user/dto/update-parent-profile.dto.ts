import { ApiProperty } from '@nestjs/swagger';
export class UpdateParentProfileDto {

  @ApiProperty({ required: false, example: 'Jane Doe' })
  name?: string;

  @ApiProperty({ required: false, example: 'en' })
  language?: string;

  @ApiProperty({ required: false, example: 'Nigeria' })
  country?: string;

  @ApiProperty({ required: false, example: true })
  biometricsEnabled?: boolean;

  @ApiProperty({ required: false, example: ['category-uuid-1', 'category-uuid-2'] })
  preferredCategories?: string[];

  @ApiProperty({ required: false, example: ['expectation-uuid-1', 'expectation-uuid-2'] })
  learningExpectationIds?: string[];
}
