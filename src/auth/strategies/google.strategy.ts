import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy } from 'passport-custom';
import { OAuth2Client } from 'google-auth-library';
import { GoogleOAuthProfile } from '@/common/types';
import { Request } from 'express';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy,
  'google-id-token',
) {
  private readonly logger = new Logger(GoogleStrategy.name);
  private googleClient: OAuth2Client;

  constructor(private configService: ConfigService) {
    super();
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  /** Mobile/Web will POST an id_token → we validate it here */
  async validate(req: Request): Promise<GoogleOAuthProfile> {
    const idToken = req.body?.idToken || req.body?.id_token;

    if (!idToken) {
      throw new UnauthorizedException('Missing Google ID token');
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });

      const payload = ticket.getPayload();
      if (!payload) throw new UnauthorizedException('Invalid Google token');

      if (!payload.email || !payload.sub) {
        throw new UnauthorizedException('Invalid Google token: missing email or sub');
      }

      return {
        email: payload.email,
        firstName: payload.given_name,
        lastName: payload.family_name,
        picture: payload.picture,
        emailVerified: payload.email_verified,
        provider: 'google',
        providerId: payload.sub,
      };
    } catch (e) {
      this.logger.error('Google token validation failed:', e);
      throw new UnauthorizedException('Invalid Google token');
    }
  }
}
