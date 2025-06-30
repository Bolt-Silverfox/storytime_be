import { ApiProperty } from '@nestjs/swagger';

export enum NotificationType {
  EMAIL = 'email',
  PUSH = 'push',
  // add more as needed
}

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
  @ApiProperty()
  type: string;
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
