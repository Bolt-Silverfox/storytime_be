import { ApiProperty } from '@nestjs/swagger';
import { NotificationCategory as PrismaCategory, NotificationType as PrismaType } from '@prisma/client';

export const NotificationType = PrismaType;
export type NotificationType = PrismaType;

export const NotificationCategory = PrismaCategory;
export type NotificationCategory = PrismaCategory;

export class CreateNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

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
