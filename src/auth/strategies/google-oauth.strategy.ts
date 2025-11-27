import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleOAuthStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID') || 'DUMMY_GOOGLE_CLIENT_ID';
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET') || 'DUMMY_GOOGLE_CLIENT_SECRET';
    const callbackBase = config.get<string>('BACKEND_BASE_URL') || 'http://localhost:3000';

    super({
      clientID,
      clientSecret,
      callbackURL: `${callbackBase}/api/v1/auth/google/oauth/callback`,
      scope: ['profile', 'email'],
    } as any);
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: Function,
  ) {
    const { id, emails, photos, name } = profile;

    done(null, {
      googleId: id,
      email: emails?.[0]?.value || null,
      name:
        `${name?.givenName || ''} ${name?.familyName || ''}`.trim() || null,
      avatar: photos?.[0]?.value || null,
      emailVerified: true,
    });
  }
}
