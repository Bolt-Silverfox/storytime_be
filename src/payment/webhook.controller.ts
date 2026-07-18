import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/shared/decorators/public.decorator';
import { AppleWebhookDto, GoogleWebhookDto } from './dto/webhook.dto';
import {
  SubscriptionWebhookService,
  WebhookProcessResult,
} from './subscription-webhook.service';

/**
 * Server-to-server webhook receiver for store subscription notifications.
 *
 * These endpoints are PUBLIC (no JWT): Apple and Google call them directly.
 * Authenticity is established by cryptographic signature verification (Apple
 * JWS x5c chain) and by re-fetching state from the store's server API
 * (Google Play Developer API), NOT by an auth header.
 *
 * They always return 200 for anything successfully received or ignorable, so
 * the stores do not enter infinite retry loops. Only genuinely malformed
 * payloads or failed signatures return 4xx; transient processing failures
 * return 5xx so the store retries.
 */
@ApiTags('payment-webhooks')
@Controller('payment/webhooks')
@SkipThrottle()
export class WebhookController {
  constructor(private readonly webhookService: SubscriptionWebhookService) {}

  @Post('apple')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apple App Store Server Notifications v2 receiver',
    description:
      'Receives ASSN v2 notifications ({ signedPayload }). Verifies the JWS ' +
      'signature, maps the notification type to a subscription state change, ' +
      'and records the event for idempotency.',
  })
  async apple(@Body() body: AppleWebhookDto): Promise<WebhookProcessResult> {
    return this.webhookService.handleApple(body);
  }

  @Post('google')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Google Play Real-time Developer Notifications (RTDN) receiver',
    description:
      'Receives Pub/Sub push messages ({ message: { data, messageId } }). ' +
      'Decodes the RTDN payload, enriches via the Play Developer API, maps ' +
      'the notification type to a subscription state change, and records the ' +
      'event for idempotency.',
  })
  async google(@Body() body: GoogleWebhookDto): Promise<WebhookProcessResult> {
    return this.webhookService.handleGoogle(body);
  }
}
