import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsInt,
  Matches,
  Min,
  Max,
} from 'class-validator';

// 1. Create Kid DTO
export class CreateKidDto {
  @ApiProperty({ example: 'Alex' })
  @IsString()
  name: string;

  @ApiProperty({ example: '4-6' })
  @IsString()
  ageRange: string;

  @ApiProperty({ required: false, example: 'avatar-uuid-123' })
  @IsOptional()
  @IsString()
  avatarId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredCategoryIds?: string[];
}

// 2. Update Kid DTO
export class UpdateKidDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  ageRange?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  avatarId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredCategoryIds?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedTags?: string[];

  // Bedtime Settings
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isBedtimeEnabled?: boolean;

  @ApiProperty({ required: false, example: '20:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Format HH:mm' })
  bedtimeStart?: string;

  @ApiProperty({ required: false, example: '07:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Format HH:mm' })
  bedtimeEnd?: string;

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  bedtimeDays?: number[];

  @IsOptional() @IsBoolean() bedtimeLockApp?: boolean;
  @IsOptional() @IsBoolean() bedtimeDimScreen?: boolean;
  @IsOptional() @IsBoolean() bedtimeReminder?: boolean;
  @IsOptional() @IsBoolean() bedtimeStoriesOnly?: boolean;
  @IsOptional() @IsInt() dailyScreenTimeLimitMins?: number;

  //Frontend can send a UUID (local) OR an ElevenLabs ID (external)
  @ApiProperty({ required: false, example: 'voice-uuid-OR-elevenlabs-id' })
  @IsOptional()
  @IsString()
  preferredVoiceId?: string;
}
