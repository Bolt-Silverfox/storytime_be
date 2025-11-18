import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsStrongPassword,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'test@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @ApiProperty({ example: 'testPassword1#' })
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  password: string;

  @ApiProperty({ example: 'Mr' })
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @IsNotEmpty()
  fullName: string;
}
