import { ApiProperty } from '@nestjs/swagger';

export class EnableBiometricsDto {
  @ApiProperty({
    example: true,
    description: 'Enable or disable biometrics',
  })
  enable: boolean;
}
