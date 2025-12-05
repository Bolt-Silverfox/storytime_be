import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisableBiometricsDto {
  @ApiProperty({ example: 'device-12345' })
  @IsString()
  deviceId: string;
}