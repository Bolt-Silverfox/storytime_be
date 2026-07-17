import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response of `POST /payment/cancel`.
 *
 * Always returns the updated subscription (status becomes `cancelled`, access
 * kept until `endsAt`). For Apple subscriptions whose auto-renewal is still
 * active on the device, it additionally includes `warning` + `manageUrl` so the
 * client can prompt the user to stop renewal in their Apple account — the
 * backend cannot cancel Apple auto-renewal on the user's behalf.
 */
export class CancelSubscriptionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() plan: string;
  @ApiProperty({ example: 'cancelled' }) status: string;
  @ApiProperty() startedAt: Date;
  @ApiPropertyOptional({ nullable: true }) endsAt: Date | null;
  @ApiPropertyOptional({ nullable: true, description: '"google" or "apple"' })
  platform: string | null;
  @ApiPropertyOptional({ nullable: true }) productId: string | null;
  @ApiPropertyOptional({ nullable: true }) purchaseToken: string | null;
  @ApiProperty() isDeleted: boolean;
  @ApiPropertyOptional({ nullable: true }) deletedAt: Date | null;

  @ApiPropertyOptional({
    description:
      'Platform-specific warning. Present only for Apple subscriptions whose ' +
      'auto-renewal is still active; tells the user to cancel renewal on their ' +
      'Apple device.',
  })
  warning?: string;

  @ApiPropertyOptional({
    description:
      'Deep link to the platform subscription-management screen (Apple), ' +
      'present alongside `warning`.',
    example: 'https://apps.apple.com/account/subscriptions',
  })
  manageUrl?: string;
}
