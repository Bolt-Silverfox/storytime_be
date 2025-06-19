import { ApiProperty } from '@nestjs/swagger';

export class CreateNotificationPreferenceDto {
  @ApiProperty({ description: 'Type of notification (e.g. email, push)' })
  type: string;
  @ApiProperty({ description: 'Enable or disable this notification type' })
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
