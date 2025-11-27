import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class EnableBiometricsDto {
  @ApiProperty({
    example: true,
    description: 'Enable or disable biometrics',
  })
  @IsBoolean()
  enable: boolean;
}
