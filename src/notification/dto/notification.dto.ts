import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  NotificationCategory as PrismaCategory,
  NotificationType as PrismaType,
} from '@prisma/client';

export const NotificationType = PrismaType;
export type NotificationType = PrismaType;

export const NotificationCategory = PrismaCategory;
export type NotificationCategory = PrismaCategory;

export class CreateNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({
    required: false,
    description: 'User ID (optional, for user-level preference)',
  })
  userId?: string;

  @ApiProperty({
    required: false,
    description: 'Kid ID (optional, for kid-level preference)',
  })
  kidId?: string;
}

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class BulkUpdateNotificationPreferenceDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class NotificationPreferenceDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ required: false })
  userId?: string;

  @ApiProperty({ required: false })
  kidId?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class NotificationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty()
  data: Record<string, unknown> | null;

  @ApiProperty()
  isRead: boolean;

  @ApiProperty()
  createdAt: Date;
}

export class MarkReadDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  notificationIds: string[];
}

/**
 * Grouped preferences response format.
 * Example: { "NEW_STORY": true, "STORY_FINISHED": false }
 */
export class GroupedPreferencesDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    description: 'Map of category to enabled status',
    example: { NEW_STORY: true, STORY_FINISHED: false },
  })
  preferences: Record<string, boolean>;
}

/**
 * Update user preferences (bulk or single category).
 * Example: { "NEW_STORY": true, "STORY_FINISHED": false }
 * Sent as plain JSON object in request body.
 */
export class UpdateUserPreferencesDto {
  [category: string]: boolean;
}
