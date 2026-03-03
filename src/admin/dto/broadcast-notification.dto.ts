import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class BroadcastNotificationDto {
  @ApiProperty({ example: 'New Story Available!' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example:
      "Check out 'The Magic Forest' - a new adventure awaits!",
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    example: 'all_users',
    description: 'FCM topic to broadcast to (defaults to all_users)',
  })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({
    example: { storyId: '123e4567-e89b-12d3-a456-426614174000' },
    description: 'Optional data payload for deep linking',
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}
