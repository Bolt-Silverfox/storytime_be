import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationPreferenceService } from '@/notification/services/notification-preference.service';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import { OAuth2Client } from 'google-auth-library';
import { GoogleOAuthProfile } from '@/shared/types';
import { UserDto } from '../dto/auth.dto';
import appleSigninAuth from 'apple-signin-auth';
import * as crypto from 'crypto';

interface OAuthPayload {
  googleId?: string;
  appleId?: string;
  email: string;
  picture?: string | null;
  name?: string | null;
  emailVerified?: boolean;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationPreferenceService: NotificationPreferenceService,
    private readonly tokenService: TokenService,
    private readonly passwordService: PasswordService,
  ) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId) {
      this.googleClient = new OAuth2Client(clientId);
    }
  }

  // ==================== GOOGLE OAUTH ====================

  async loginWithGoogleIdToken(idToken: string) {
    if (!idToken) {
      throw new BadRequestException('id_token is required');
    }

    if (!this.googleClient) {
      throw new ServiceUnavailableException('Google client not configured');
    }

    let ticket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      this.logger.error('Google id_token verification failed', err);
      throw new UnauthorizedException('Invalid Google id_token');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google token payload');
    }

    const googlePayload: OAuthPayload = {
      googleId: payload.sub,
      email: payload.email,
      picture: payload.picture || null,
      name:
        `${payload.given_name || ''} ${payload.family_name || ''}`.trim() ||
        payload.name ||
        null,
      emailVerified: payload.email_verified === true,
    };

    return this.upsertOrReturnUserFromOAuthPayload(googlePayload);
  }

  async handleGoogleOAuthPayload(payload: GoogleOAuthProfile) {
    return this.upsertOrReturnUserFromOAuthPayload({
      googleId: payload.providerId,
      email: payload.email,
      picture: payload.picture,
      name:
        `${payload.firstName || ''} ${payload.lastName || ''}`.trim() ||
        undefined,
      emailVerified: payload.emailVerified,
    });
  }

  // ==================== APPLE OAUTH ====================

  async loginWithAppleIdToken(
    idToken: string,
    firstName?: string,
    lastName?: string,
  ) {
    if (!idToken) {
      throw new BadRequestException('id_token is required');
    }

    try {
      const {
        sub: appleId,
        email,
        email_verified,
      } = await appleSigninAuth.verifyIdToken(idToken, {
        audience: [process.env.APPLE_CLIENT_ID, process.env.APPLE_SERVICE_ID],
        nonce: 'NONCE',
        ignoreExpiration: false,
      });

      const name =
        firstName && lastName ? `${firstName} ${lastName}` : undefined;

      return this.upsertOrReturnUserFromOAuthPayload({
        appleId,
        email,
        emailVerified: email_verified === 'true' || email_verified === true,
        name,
      });
    } catch (err) {
      this.logger.error('Apple id_token verification failed', err);
      throw new UnauthorizedException('Invalid Apple id_token');
    }
  }

  // ==================== INTERNAL: Unified OAuth upsert logic ====================

  private async upsertOrReturnUserFromOAuthPayload(payload: OAuthPayload) {
    const { googleId, appleId, email, picture, name, emailVerified } = payload;

    let user = null;

    // 1. Try find by googleId or appleId
    if (googleId) {
      user = await this.prisma.user.findFirst({
        where: { googleId },
        include: { profile: true, avatar: true },
      });
    } else if (appleId) {
      user = await this.prisma.user.findFirst({
        where: { appleId },
        include: { profile: true, avatar: true },
      });
    }

    // 2. Try find by email
    if (!user) {
      const existing = await this.prisma.user.findUnique({ where: { email } });

      if (existing) {
        user = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            isEmailVerified: emailVerified ? true : existing.isEmailVerified,
            googleId: googleId || existing.googleId,
            appleId: appleId || existing.appleId,
          },
          include: { profile: true, avatar: true },
        });
      }
    }

    // 3. Create new user
    if (!user) {
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword =
        await this.passwordService.hashPassword(randomPassword);

      user = await this.prisma.user.create({
        data: {
          name: name || email || 'User',
          email,
          passwordHash: hashedPassword,
          isEmailVerified: emailVerified === true,
          googleId: googleId || null,
          appleId: appleId || null,
          role: 'parent',
          profile: {
            create: {
              country: 'NG',
            },
          },
        },
        include: { profile: true, avatar: true },
      });

      // Seed default notification preferences for new OAuth users
      try {
        await this.notificationPreferenceService.seedDefaultPreferences(user.id);
      } catch (error) {
        this.logger.error(
          'Failed to seed notification preferences:',
          error.message,
        );
      }
    }

    // 4. Handle avatar from OAuth picture
    if (picture) {
      let avatar = await this.prisma.avatar.findFirst({
        where: { url: picture },
      });

      if (!avatar) {
        avatar = await this.prisma.avatar.create({
          data: {
            url: picture,
            name: `oauth_${googleId || appleId || user.id}`,
            isSystemAvatar: false,
          },
        });
      }

      if (user.avatarId !== avatar.id) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { avatarId: avatar.id },
          include: { profile: true, avatar: true },
        });
      }
    }

    // 5. Must be verified
    if (!user.isEmailVerified) {
      throw new BadRequestException(
        'Email not verified. Please check your inbox.',
      );
    }

    // 6. Build response
    const numberOfKids = await this.prisma.kid.count({
      where: { parentId: user.id },
    });

    const userDto = new UserDto({ ...user, numberOfKids });
    const tokenData = await this.tokenService.createTokenPair(userDto);

    return {
      user: userDto,
      jwt: tokenData.jwt,
      refreshToken: tokenData.refreshToken,
    };
  }
}
