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
}
