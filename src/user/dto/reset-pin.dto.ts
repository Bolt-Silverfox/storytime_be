import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ResetPinDto {
  @ApiProperty({ example: '123456', description: 'Current 6-digit PIN' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'oldPin must be exactly 6 digits' })
  oldPin: string;

  @ApiProperty({ example: '654321', description: 'New 6-digit PIN' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'newPin must be exactly 6 digits' })
  newPin: string;

  @ApiProperty({ example: '654321', description: 'Confirm new 6-digit PIN' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'confirmNewPin must be exactly 6 digits' })
  confirmNewPin: string;
}
