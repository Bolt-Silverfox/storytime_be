import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SetPinDto {
  @ApiProperty({
    example: '123456',
    description: '6-digit numeric PIN for parental controls',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'PIN must be exactly 6 digits' })
  pin: string;
}
