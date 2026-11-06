import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

const NormalizeEmail = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export class PasswordlessRequestDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  @MaxLength(254)
  @NormalizeEmail()
  email: string;
}

export class PasswordlessVerifyDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  @MaxLength(254)
  @NormalizeEmail()
  email: string;

  @ApiProperty({ example: '482913' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class PasswordlessConsumeDto {
  @ApiProperty({ example: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token: string;
}

export class PasswordlessRequestResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ example: 600 })
  expiresInSeconds: number;

  @ApiProperty({ example: 60 })
  resendAfterSeconds: number;
}
