import { ApiProperty } from '@nestjs/swagger';
import { NotificationCategory as PrismaCategory, NotificationType as PrismaType } from '@prisma/client';

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
  data: any;

  @ApiProperty()
  isRead: boolean;

  @ApiProperty()
  createdAt: Date;
}

export class MarkReadDto {
  @ApiProperty({ type: [String] })
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

export class ChannelPreferenceDto {
  @ApiProperty()
  push: boolean;

  @ApiProperty()
  in_app: boolean;
}

export class UserPreferencesResponseDto {
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  EMAIL_VERIFICATION?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  PASSWORD_RESET?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  PASSWORD_RESET_ALERT?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  PASSWORD_CHANGED?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  PIN_RESET?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  NEW_LOGIN?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  SUBSCRIPTION_REMINDER?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  SUBSCRIPTION_ALERT?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  PAYMENT_SUCCESS?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  PAYMENT_FAILED?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  NEW_STORY?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  STORY_FINISHED?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  STORY_RECOMMENDATION?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  WE_MISS_YOU?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  INCOMPLETE_STORY_REMINDER?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  DAILY_LISTENING_REMINDER?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  DAILY_CHALLENGE_REMINDER?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  ACHIEVEMENT_UNLOCKED?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  BADGE_EARNED?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  STREAK_MILESTONE?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  SCREEN_TIME_LIMIT?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  BEDTIME_REMINDER?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  WEEKLY_REPORT?: ChannelPreferenceDto;
  @ApiProperty({ type: ChannelPreferenceDto, required: false })
  SYSTEM_ALERT?: ChannelPreferenceDto;
}

/**
 * Update user preferences (bulk or single category).
 * Map of category to boolean enabled status.
 */
export class UpdateUserPreferencesDto {
  // Auth & Security
  @ApiProperty({ required: false })
  EMAIL_VERIFICATION?: boolean;

  @ApiProperty({ required: false })
  PASSWORD_RESET?: boolean;

  @ApiProperty({ required: false })
  PASSWORD_RESET_ALERT?: boolean;

  @ApiProperty({ required: false })
  PASSWORD_CHANGED?: boolean;

  @ApiProperty({ required: false })
  PIN_RESET?: boolean;

  @ApiProperty({ required: false })
  NEW_LOGIN?: boolean;

  // Subscription & Billing
  @ApiProperty({ required: false })
  SUBSCRIPTION_REMINDER?: boolean;

  @ApiProperty({ required: false })
  SUBSCRIPTION_ALERT?: boolean;

  @ApiProperty({ required: false })
  PAYMENT_SUCCESS?: boolean;

  @ApiProperty({ required: false })
  PAYMENT_FAILED?: boolean;

  // Engagement
  @ApiProperty({ required: false })
  NEW_STORY?: boolean;

  @ApiProperty({ required: false })
  STORY_FINISHED?: boolean;

  @ApiProperty({ required: false })
  STORY_RECOMMENDATION?: boolean;

  @ApiProperty({ required: false })
  WE_MISS_YOU?: boolean;

  // Reminders
  @ApiProperty({ required: false })
  INCOMPLETE_STORY_REMINDER?: boolean;

  @ApiProperty({ required: false })
  DAILY_LISTENING_REMINDER?: boolean;

  @ApiProperty({ required: false })
  DAILY_CHALLENGE_REMINDER?: boolean;

  // Progress
  @ApiProperty({ required: false })
  ACHIEVEMENT_UNLOCKED?: boolean;

  @ApiProperty({ required: false })
  BADGE_EARNED?: boolean;

  @ApiProperty({ required: false })
  STREAK_MILESTONE?: boolean;

  // Parental
  @ApiProperty({ required: false })
  SCREEN_TIME_LIMIT?: boolean;

  @ApiProperty({ required: false })
  BEDTIME_REMINDER?: boolean;

  @ApiProperty({ required: false })
  WEEKLY_REPORT?: boolean;

  // System
  @ApiProperty({ required: false })
  SYSTEM_ALERT?: boolean;
}
