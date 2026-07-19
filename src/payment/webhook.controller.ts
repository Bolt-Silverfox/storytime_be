import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/shared/decorators/public.decorator';
import { AppleWebhookDto, GoogleWebhookDto } from './dto/webhook.dto';
import { GooglePubSubVerifierService } from './google-pubsub-verifier.service';
import {
  SubscriptionWebhookService,
  WebhookProcessResult,
} from './subscription-webhook.service';

/**
 * Server-to-server webhook receiver for store subscription notifications.
 *
 * These endpoints are PUBLIC (no app JWT): Apple and Google call them directly.
 * Authenticity is established per platform:
 *  - Apple: the ASSN v2 JWS x5c signature chain (verified in the service).
 *  - Google: the OIDC identity token that a configured Pub/Sub push
 *    subscription sends in the Authorization header (verified here), plus a
 *    re-fetch of authoritative state from the Play Developer API.
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
  constructor(
    private readonly webhookService: SubscriptionWebhookService,
    private readonly pubsubVerifier: GooglePubSubVerifierService,
  ) {}

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
      'Verifies the Pub/Sub push OIDC token (when configured), decodes the ' +
      'RTDN payload, enriches via the Play Developer API, maps the ' +
      'notification type to a subscription state change, and records the ' +
      'event for idempotency.',
  })
  async google(
    @Body() body: GoogleWebhookDto,
    @Headers('authorization') authorization?: string,
  ): Promise<WebhookProcessResult> {
    // Authenticate the caller as Google's Pub/Sub push service before doing
    // any work. Throws 401 when a configured endpoint gets an invalid/missing
    // token; no-ops (with a warning) when verification is not configured.
    await this.pubsubVerifier.verifyPushRequest(authorization);
    return this.webhookService.handleGoogle(body);
  }
}
