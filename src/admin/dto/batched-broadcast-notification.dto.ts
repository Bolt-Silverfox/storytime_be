import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Batched broadcast: send a push to every active device token in staggered
 * chunks (<= 500 tokens per FCM multicast call) instead of a single topic
 * fan-out. Staggering avoids every user opening the app at the same instant,
 * which protects the connection-capped production RDS instance.
 */
export class BatchedBroadcastNotificationDto {
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
    example: { storyId: '123e4567-e89b-12d3-a456-426614174000' },
    description: 'Optional data payload for deep linking',
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;

  @ApiPropertyOptional({
    example: 500,
    minimum: 1,
    maximum: 500,
    default: 500,
    description:
      'Device tokens per push job. Capped at 500 (FCM multicast hard limit).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  batchSize?: number = 500;

  @ApiPropertyOptional({
    example: 120,
    minimum: 0,
    maximum: 3600,
    default: 120,
    description:
      'Seconds between batches. Batch i is delayed by i * intervalSeconds.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  intervalSeconds?: number = 120;
}
