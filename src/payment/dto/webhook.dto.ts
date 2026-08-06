import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Apple App Store Server Notifications v2 request body.
 * Apple POSTs a single JWS (JSON Web Signature) string.
 * @see https://developer.apple.com/documentation/appstoreservernotifications
 */
export class AppleWebhookDto {
  @ApiProperty({
    description: 'Apple ASSN v2 signed payload (JWS)',
    example: 'eyJhbGciOiJFUzI1NiIs...',
  })
  @IsString()
  @IsNotEmpty()
  signedPayload: string;
}

/**
 * Google Cloud Pub/Sub push message envelope.
 * Google Play RTDN messages are delivered via a Pub/Sub push subscription.
 * @see https://developer.android.com/google/play/billing/rtdn-reference
 */
export class GooglePubSubMessageDto {
  @ApiProperty({
    description: 'Base64-encoded RTDN payload JSON',
  })
  @IsString()
  @IsNotEmpty()
  data: string;

  @ApiProperty({ description: 'Pub/Sub message id (used for idempotency)' })
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  publishTime?: string;
}

export class GoogleWebhookDto {
  @ApiProperty({ type: GooglePubSubMessageDto })
  @IsObject()
  @ValidateNested()
  @Type(() => GooglePubSubMessageDto)
  message: GooglePubSubMessageDto;

  @ApiProperty({ required: false, description: 'Pub/Sub subscription name' })
  @IsOptional()
  @IsString()
  subscription?: string;
}
