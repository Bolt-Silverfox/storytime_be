import { IsString, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnableBiometricsDto {
  @ApiProperty({ example: 'device-12345' })
  @IsString()
  deviceId: string;

  @ApiProperty({
    example: true,
    description: 'True ONLY if device supports FaceID/Fingerprint',
  })
  @IsBoolean()
  hasBiometrics: boolean;
}
