import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

export class RequestPinResetOtpDto {
  // No body needed - user is already authenticated
}

export class ValidatePinResetOtpDto {
  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code sent to email',
  })
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;
}

export class ResetPinWithOtpDto {
  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code',
  })
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @ApiProperty({
    example: '123456',
    description: 'New 6-digit PIN',
  })
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'PIN must be exactly 6 digits' })
  newPin: string;

  @ApiProperty({
    example: '123456',
    description: 'Confirm new 6-digit PIN',
  })
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'PIN must be exactly 6 digits' })
  confirmNewPin: string;
}
