
import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
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

export class AvatarDto {
  @ApiProperty({ example: 'id' })
  id: string;

  @ApiProperty({ example: 'Avatar Name' })
  name: string | null;

  @ApiProperty({ example: 'https://avatar.com' })
  url: string;

  @ApiProperty({ example: true })
  isSystemAvatar: boolean;

  @ApiProperty({ example: 'public_id' })
  publicId: string | null;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;
}

export class UserDto {
  @ApiProperty({ example: 'id' })
  id: string;

  @ApiProperty({ example: 'test@gmail.com' })
  email: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Optional()
  name: string | null;

  @ApiProperty({ example: 'https://avatar.com', required: false })
  @Optional()
  avatarUrl?: string | null;

  @ApiProperty({ type: AvatarDto, required: false })
  @Optional()
  avatar?: AvatarDto | null;

  @ApiProperty({ example: 'user' })
  role: string;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: 'Mr', required: false })
  @Optional()
  title?: string | null;

  @ApiProperty({ type: ProfileDto })
  profile: ProfileDto | null;

  @ApiProperty({ example: 2, required: false })
  @Optional()
  numberOfKids?: number;

  constructor(user: Partial<UserDto> & { profile?: any; avatar?: any; kids?: any[] }) {
    this.profile = user.profile ? new ProfileDto(user.profile) : null;
    
    this.avatar = user.avatar ? {
      id: user.avatar.id,
      name: user.avatar.name,
      url: user.avatar.url,
      isSystemAvatar: user.avatar.isSystemAvatar,
      publicId: user.avatar.publicId,
      createdAt: user.avatar.createdAt,
    } : null;

    this.id = user.id as string;
    this.email = user.email as string;
    this.name = user.name as string;
    this.avatarUrl = user.avatar?.url || null;
    this.role = user.role as string;
    this.createdAt = user.createdAt as Date;
    this.updatedAt = user.updatedAt as Date;
    this.numberOfKids = user.kids?.length || user.numberOfKids || 0;
    this.title = user.title ?? null;
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
  @IsOptional()
  explicitContent?: boolean;

  @ApiProperty({ example: 50 })
  @IsOptional()
  maxScreenTimeMins?: number;

  @ApiProperty({ example: 'english' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  language?: string;

  @ApiProperty({ example: 'nigeria' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsOptional()
  country?: string;
}

export class kidDto {
  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @Optional()
  name: string;

  @ApiProperty({ example: 'avatar-id' })
  @IsOptional()
  avatarId?: string;

  @ApiProperty({ example: '1-3' })
  @IsOptional()
  ageRange?: string;
}

export class updateKidDto {
  @ApiProperty({ example: 'eqiv989bqem' })
  @IsOptional()
  id: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @IsOptional()
  name: string;

  @ApiProperty({ example: 'avatar-id' })
  @IsOptional()
  avatarId?: string;

  @ApiProperty({ example: '1-3', required: false })
  @IsOptional()
  ageRange?: string;

}
export class RequestResetDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;
}
export class ValidateResetTokenDto {
  @ApiProperty({ example: 'token' })
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'token' })
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'NewStrongPassword1#' })
  @IsNotEmpty()
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  newPassword: string;
}

// ===== Password Reset DTOs =====
export class RequestResetDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ValidateResetTokenDto {
  @ApiProperty({ example: 'reset-token-from-email' })
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token-from-email' })
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'NewStrongPassword1#' })
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  newPassword: string;
}
