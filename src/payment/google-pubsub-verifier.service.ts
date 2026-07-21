import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

/**
 * Verifies the OIDC identity token that a correctly-configured Google Cloud
 * Pub/Sub *push* subscription attaches to every delivery in the
 * `Authorization: Bearer <jwt>` header.
 *
 * The `/payment/webhooks/google` endpoint is otherwise public, so without this
 * check any caller could POST a forged RTDN envelope. Verifying the OIDC token
 * proves the request actually came from Google's Pub/Sub service acting as the
 * configured push service account.
 *
 * Posture:
 *  - In production (`NODE_ENV=production`): BOTH `GOOGLE_PUBSUB_AUDIENCE` and
 *    `GOOGLE_PUBSUB_SA_EMAIL` are required. Missing either => FAIL CLOSED (401),
 *    so production never accepts a forged, or a merely audience-scoped, RTDN
 *    webhook (audience-only would accept any Google-verified service account).
 *  - Non-production, audience set: ENFORCED — an invalid/missing token is
 *    rejected (401); a missing SA email only downgrades to "any Google SA for
 *    this audience" with a warning.
 *  - Non-production, audience unset: verification is skipped with a warning so
 *    local and unconfigured setups keep working.
 *
 * Required Pub/Sub push-subscription settings (Google Cloud console / gcloud):
 *  - Enable "Enable authentication" on the push subscription.
 *  - Service account: the account in `GOOGLE_PUBSUB_SA_EMAIL`.
 *  - Audience: the exact string in `GOOGLE_PUBSUB_AUDIENCE` (commonly the
 *    endpoint URL, e.g. https://api.example.com/payment/webhooks/google).
 */
@Injectable()
export class GooglePubSubVerifierService {
  private readonly logger = new Logger(GooglePubSubVerifierService.name);
  private readonly audience: string;
  private readonly saEmail: string;
  private readonly isProduction: boolean;
  private readonly oauthClient: OAuth2Client;
  private warnedUnconfigured = false;

  constructor(private readonly configService: ConfigService) {
    this.audience = (
      this.configService.get<string>('GOOGLE_PUBSUB_AUDIENCE') || ''
    ).trim();
    this.saEmail = (
      this.configService.get<string>('GOOGLE_PUBSUB_SA_EMAIL') || ''
    ).trim();
    this.isProduction =
      (this.configService.get<string>('NODE_ENV') || '').trim() ===
      'production';
    // OAuth2Client.verifyIdToken fetches and caches Google's public signing
    // certs (JWKS) and validates the signature, `iss`, `aud` and `exp`.
    this.oauthClient = new OAuth2Client();
  }

  /**
   * Verify the Pub/Sub push OIDC token. Resolves when the request is
   * authenticated (or verification is intentionally disabled); throws
   * `UnauthorizedException` when a configured endpoint receives an
   * invalid/missing/unauthorized token.
   */
  async verifyPushRequest(authorizationHeader?: string): Promise<void> {
    // Production must have BOTH the audience AND the service-account email so
    // the webhook is fully locked to our push subscription. Missing either =>
    // fail CLOSED (never accept an unauthenticated/partially-verified RTDN
    // webhook). Audience-only would accept any Google-verified service account.
    if (this.isProduction && (!this.audience || !this.saEmail)) {
      this.logger.error(
        'Pub/Sub OIDC verification is incomplete in production - rejecting the ' +
          'webhook. Configure GOOGLE_PUBSUB_AUDIENCE and GOOGLE_PUBSUB_SA_EMAIL ' +
          'on the push subscription so /payment/webhooks/google can authenticate ' +
          'callers.',
      );
      throw new UnauthorizedException(
        'Pub/Sub OIDC verification is not fully configured',
      );
    }

    if (!this.audience) {
      // Non-production only (production is handled above): skip with a warning
      // so local/unconfigured setups keep working.
      if (!this.warnedUnconfigured) {
        this.logger.warn(
          'GOOGLE_PUBSUB_AUDIENCE is not set - skipping Pub/Sub OIDC ' +
            'verification. PRODUCTION MUST set GOOGLE_PUBSUB_AUDIENCE and ' +
            'GOOGLE_PUBSUB_SA_EMAIL so /payment/webhooks/google rejects ' +
            'unauthenticated callers.',
        );
        this.warnedUnconfigured = true;
      }
      return;
    }

    const token = this.extractBearer(authorizationHeader);
    if (!token) {
      throw new UnauthorizedException(
        'Missing Pub/Sub OIDC bearer token on webhook request',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      // Validates signature against Google's JWKS, `iss` (accounts.google.com),
      // `aud` (this.audience) and `exp`. Throws on any failure.
      const ticket = await this.oauthClient.verifyIdToken({
        idToken: token,
        audience: this.audience,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `Pub/Sub OIDC token verification failed: ${this.errorMessage(error)}`,
      );
      throw new UnauthorizedException('Invalid Pub/Sub OIDC token');
    }

    if (!payload) {
      throw new UnauthorizedException('Pub/Sub OIDC token has no payload');
    }

    if (payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Pub/Sub OIDC token email is not verified',
      );
    }

    if (this.saEmail) {
      if (payload.email !== this.saEmail) {
        this.logger.warn(
          'Pub/Sub OIDC token email does not match configured SA',
        );
        throw new UnauthorizedException(
          'Pub/Sub OIDC token is not from the authorized service account',
        );
      }
    } else {
      this.logger.warn(
        'GOOGLE_PUBSUB_SA_EMAIL is not set - accepting any Google-verified ' +
          'service account for the configured audience. Set it to restrict to ' +
          'your push service account.',
      );
    }
  }

  private extractBearer(header?: string): string | null {
    if (!header) return null;
    // Parse the "Bearer <token>" scheme WITHOUT a backtracking-prone regex.
    // The previous /^Bearer\s+(.+)$/ let `\s+` and `.+` both match whitespace,
    // a polynomial-ReDoS on the attacker-controlled Authorization header.
    const trimmed = header.trim();
    const firstSpace = trimmed.search(/\s/); // single class, no quantifier — linear
    if (firstSpace === -1) return null;
    if (trimmed.slice(0, firstSpace).toLowerCase() !== 'bearer') return null;
    const token = trimmed.slice(firstSpace + 1).trim();
    return token || null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
