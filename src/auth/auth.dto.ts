import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsStrongPassword,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum TokenType {
  VERIFICATION = 'verification',
  PASSWORD_RESET = 'password_reset',
}

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

export class LoginDto {
  @ApiProperty({ example: 'test@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'testPassword1#' })
  @IsNotEmpty()
  password: string;
}

export class ProfileDto {
  @ApiProperty({ example: 'id' })
  id: string;

  @ApiProperty({ example: true })
  explicitContent: boolean;

  @ApiProperty({ example: 50 })
  maxScreenTimeMins: number | null;

  @ApiProperty({ example: 'english' })
  language: string | null;

  @ApiProperty({ example: 'nigeria' })
  country: string | null;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;

  constructor(profile: Partial<ProfileDto>) {
    Object.assign(this, profile);
  }
}

export class UserDto {
  @ApiProperty({ example: 'id' })
  id: string;

  @ApiProperty({ example: 'test@gmail.com' })
  email: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Optional()
  name: string | null;

  @ApiProperty({ example: 'https://avatar.com' })
  avatarUrl: string | null;

  @ApiProperty({ example: 'user' })
  role: string;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ type: ProfileDto })
  profile: ProfileDto | null;

  // constructor(user: Partial<UserDto>) {
  //   Object.assign(this, user);
  // }
  constructor(user: Partial<UserDto> & { profile?: any }) {
    // Convert raw profile to ProfileDto if it exists
    this.profile = user.profile ? new ProfileDto(user.profile) : null;
    // Assign the rest of the user properties
    // Object.assign(this, { ...user, profile: undefined }); // avoid overwriting with raw profile
    this.id = user.id as string;
    this.email = user.email as string;
    this.name = user.name as string;
    this.avatarUrl = user.avatarUrl as string;
    this.role = user.role as string;
    this.createdAt = user.createdAt as Date;
    this.updatedAt = user.updatedAt as Date;
  }
}

export class LoginResponseDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ example: 'token' })
  jwt: string;

  @ApiProperty({ example: 'refreshtoken' })
  refreshToken: string;
}

export class RefreshResponseDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ example: 'token' })
  jwt: string;
}

export class updateProfileDto {
  @ApiProperty({ example: true })
  @Optional()
  explicitContent?: boolean;

  @ApiProperty({ example: 50 })
  @Optional()
  maxScreenTimeMins?: number;

  @ApiProperty({ example: 'english' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @Optional()
  language?: string;

  @ApiProperty({ example: 'nigeria' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @Optional()
  country?: string;
}

export class kidDto {
  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @Optional()
  name: string;

  @ApiProperty({ example: 'https://example.com' })
  @Optional()
  avatarUrl?: string;
}

export class updateKidDto {
  @ApiProperty({ example: 'eqiv989bqem' })
  @Optional()
  id: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @Optional()
  name: string;

  @ApiProperty({ example: 'https://example.com' })
  @Optional()
  avatarUrl?: string;
}
