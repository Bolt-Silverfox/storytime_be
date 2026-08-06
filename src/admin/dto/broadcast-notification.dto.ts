import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class BroadcastNotificationDto {
  @ApiProperty({ example: 'New Story Available!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(65)
  title: string;

  @ApiProperty({
    example: "Check out 'The Magic Forest' - a new adventure awaits!",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  body: string;

  @ApiPropertyOptional({
    example: 'all_users_production',
    description:
      'FCM topic to broadcast to. Defaults to the environment-scoped topic ' +
      '`all_users_<NODE_ENV>` (e.g. all_users_production) so broadcasts never ' +
      'bleed across environments that share a Firebase project. Omit this field ' +
      "in normal use; if provided it MUST equal this environment's topic — " +
      'legacy `all_users` and other environments’ topics are rejected (400).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9\-_.~%]+$/, {
    message: 'Topic must contain only valid FCM topic characters',
  })
  topic?: string;

  @ApiPropertyOptional({
    example: { storyId: '123e4567-e89b-12d3-a456-426614174000' },
    description: 'Optional data payload for deep linking',
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}
