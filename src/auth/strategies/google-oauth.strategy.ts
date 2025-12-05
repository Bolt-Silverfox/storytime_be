import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleOAuthStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID')!,
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET')!,
      callbackURL: `${config.get<string>(
        'BACKEND_BASE_URL',
      )}/api/v1/auth/google/oauth/callback`,
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
      name: `${name?.givenName || ''} ${name?.familyName || ''}`.trim() || null,
      avatar: photos?.[0]?.value || null,
      emailVerified: true,
    });
  }
}
