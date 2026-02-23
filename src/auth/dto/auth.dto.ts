import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsStrongPassword,
  Matches,
  IsString,
  MaxLength,
  IsArray,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

// Helper function to sanitize email inputs (DRY principle)
const SanitizeEmail = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export enum TokenType {
  VERIFICATION = 'verification',
  PASSWORD_RESET = 'password_reset',
}

// ==================== REGISTRATION (UPDATED) ====================
export class RegisterDto {
  @ApiProperty({ example: 'test@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  @SanitizeEmail()
  email: string;

  @IsNotEmpty()
  @ApiProperty({ example: 'testPassword1#' })
  @IsStrongPassword(
    {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message:
        'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 symbol',
    },
  )
  @MaxLength(32, { message: 'Password is too long (max 32 characters)' })
  password: string;
  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'parent', required: false })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ example: 'secret', required: false })
  @IsOptional()
  @IsString()
  adminSecret?: string;
}

// ==================== COMPLETE PROFILE DTO (NEW) ====================
// ==================== COMPLETE PROFILE DTO (UPDATED) ====================
export class CompleteProfileDto {
  @ApiProperty({
    example: 'English',
    description: 'Language display name',
    required: false,
  })
  @IsOptional()
  @IsString()
  language?: string;
  @ApiProperty({
    example: 'en',
    description: 'Language code for i18n',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  languageCode?: string;

  @ApiProperty({
    example: ['expectation-uuid-1', 'expectation-uuid-2'],
    description:
      'Learning expectation IDs - character values parents want kids to learn',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  learningExpectationIds?: string[];

  @ApiProperty({
    example: ['category-id-1', 'category-id-2'],
    description: 'Preferred story categories',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredCategories?: string[];

  @ApiProperty({
    example: 'https://storage.com/avatar.jpg',
    description: 'Profile image URL',
    required: false,
  })
  @IsOptional()
  @IsString()
  profileImageUrl?: string;
}

// ==================== UPDATE PROFILE (UPDATED) ====================
export class UpdateProfileDto {
  @ApiProperty({ example: true })
  @IsOptional()
  @IsBoolean()
  explicitContent?: boolean;

  @ApiProperty({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxScreenTimeMins?: number;

  @ApiProperty({ example: 'English', description: 'Language display name' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({ example: 'en', description: 'Language code for i18n' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  languageCode?: string;

  @ApiProperty({ example: 'NG' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsOptional()
  @IsString()
  country?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'test@gmail.com' })
  @IsEmail()
  @IsNotEmpty()
  @SanitizeEmail()
  email: string;

  @ApiProperty({ example: 'testPassword1#' })
  @IsNotEmpty()
  password: string;
}

export class ProfileDto {
  @ApiProperty({ example: 'id' })
  id: string;

  @ApiProperty({ example: 'userId' })
  userId: string;

  @ApiProperty({ example: true })
  explicitContent: boolean;

  @ApiProperty({ example: 50 })
  maxScreenTimeMins: number | null;

  @ApiProperty({ example: 'en', description: 'Interface language code' })
  language: string | null;

  @ApiProperty({ example: 'NG' })
  country: string;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-10-01T12:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: false })
  isDeleted: boolean;

  @ApiProperty({ example: null })
  deletedAt: Date | null;

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

  @ApiProperty({ type: ProfileDto })
  profile: ProfileDto | null;

  @ApiProperty({ example: 2, required: false })
  @Optional()
  numberOfKids?: number;

  constructor(
    user: Partial<UserDto> & {
      profile?: Partial<ProfileDto> | null;
      avatar?: Partial<AvatarDto> | null;
      kids?: { id: string }[];
    },
  ) {
    this.profile = user.profile ? new ProfileDto(user.profile) : null;

    this.avatar = user.avatar
      ? {
          id: user.avatar.id,
          name: user.avatar.name,
          url: user.avatar.url,
          isSystemAvatar: user.avatar.isSystemAvatar,
          publicId: user.avatar.publicId,
          createdAt: user.avatar.createdAt,
        }
      : null;

    this.id = user.id as string;
    this.email = user.email as string;
    this.name = user.name as string;
    this.avatarUrl = user.avatar?.url || null;
    this.role = user.role as string;
    this.createdAt = user.createdAt as Date;
    this.updatedAt = user.updatedAt as Date;
    this.numberOfKids = user.kids?.length || user.numberOfKids || 0;
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

export class KidDto {
  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'avatar-id' })
  @IsOptional()
  @IsString()
  avatarId?: string;

  @ApiProperty({ example: '1-3' })
  @IsOptional()
  @IsString()
  ageRange?: string;
}

export class UpdateKidDto {
  @ApiProperty({ example: 'eqiv989bqem' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 'firstname lastname' })
  @Matches(/^[a-zA-Z]+(?:\s+[a-zA-Z]+)+$/, {
    message: 'Full name must contain at least two names',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'avatar-id' })
  @IsOptional()
  @IsString()
  avatarId?: string;

  @ApiProperty({ example: '1-3', required: false })
  @IsOptional()
  @IsString()
  ageRange?: string;
}

// ===== Password Reset DTOs =====
export class RequestResetDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  @SanitizeEmail()
  email: string;
}

export class ValidateResetTokenDto {
  @ApiProperty({ example: 'reset-token-from-email' })
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  @SanitizeEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token-from-email' })
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  @SanitizeEmail()
  email: string;

  @ApiProperty({ example: 'NewStrongPassword1#' })
  @IsStrongPassword(
    {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message:
        'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 symbol',
    },
  )
  @MaxLength(32, { message: 'Password is too long (max 32 characters)' })
  newPassword: string;
}

export class SendEmailVerificationDto {
  @ApiProperty({
    example: 'test@gmail.com',
    description: 'The email address to send the verification link to',
  })
  @IsEmail()
  @IsNotEmpty()
  @SanitizeEmail()
  email: string;
}

export class VerifyEmailDto {
  @ApiProperty({
    example: 'abc-123-verification-token',
    description: 'The verification token received via email',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword1#' })
  @IsNotEmpty()
  oldPassword: string;

  @ApiProperty({ example: 'NewStrongPassword1#' })
  @IsStrongPassword(
    {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message:
        'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 symbol',
    },
  )
  @MaxLength(32, { message: 'Password is too long (max 32 characters)' })
  newPassword: string;
}
