import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import appleSigninAuth from 'apple-signin-auth';
import { Prisma } from '@prisma/client';
import { AUTH_REPOSITORY, IAuthRepository } from '../repositories';

/**
 * Owns account-linking concerns for authenticated users: listing linked
 * providers and linking/unlinking Google and Apple identities.
 *
 * Extracted verbatim from AuthService to keep that class a thin orchestrator.
 * Behavior (exceptions, messages, atomic guards, transactional unlink) is
 * preserved exactly.
 */
@Injectable()
export class AccountLinkingService {
  private googleClient: OAuth2Client;

  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly authRepository: IAuthRepository,
    private readonly configService: ConfigService,
  ) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (clientId) {
      this.googleClient = new OAuth2Client(clientId);
    }
  }

  async getLinkedAccounts(userId: string) {
    const user = await this.authRepository.findUserLinkedAccountInfo(userId);

    if (!user) throw new NotFoundException('User not found');

    const accounts: {
      provider: string;
      email: string | null;
      linkedAt: string | null;
    }[] = [];

    if (user.hasLocalPassword) {
      accounts.push({ provider: 'email', email: user.email, linkedAt: null });
    }

    if (user.googleId) {
      accounts.push({ provider: 'google', email: user.email, linkedAt: null });
    }

    if (user.appleId) {
      accounts.push({ provider: 'apple', email: user.email, linkedAt: null });
    }

    return {
      success: true,
      message: 'Linked accounts retrieved',
      statusCode: 200,
      data: accounts,
    };
  }

  async linkGoogle(userId: string, idToken: string) {
    if (!this.googleClient) {
      throw new ServiceUnavailableException('Google client not configured');
    }

    const clientIds = [
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_WEB_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'),
    ].filter(Boolean);

    if (clientIds.length === 0) {
      throw new ServiceUnavailableException('No Google client IDs configured');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientIds as string[],
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google id_token');
    }

    if (!payload || !payload.sub) {
      throw new BadRequestException('Invalid Google ID token');
    }

    const googleId = payload.sub;

    // Atomic link: updateMany with `googleId: null` guard ensures we only write
    // if the field is unset. The DB unique index catches cross-user conflicts (P2002).
    let updated: { count: number };
    try {
      updated = await this.authRepository.linkGoogleAccountIfUnset(
        userId,
        googleId,
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This Google account is already linked to another user.',
        );
      }
      throw err;
    }
    if (updated.count === 0) {
      // Either user does not exist (or is soft-deleted), or googleId is already set
      const user = await this.authRepository.findActiveUserById(userId);
      if (!user) throw new NotFoundException('User not found');
      throw new BadRequestException('Google account is already linked.');
    }

    return {
      success: true,
      message: 'Google account linked successfully',
      statusCode: 200,
      data: null,
    };
  }

  async linkApple(userId: string, idToken: string) {
    const APPLE_CLIENT_ID = this.configService.get<string>('APPLE_CLIENT_ID');
    const APPLE_SERVICE_ID = this.configService.get<string>('APPLE_SERVICE_ID');
    const audiences = [APPLE_CLIENT_ID, APPLE_SERVICE_ID].filter(Boolean);

    if (audiences.length === 0) {
      throw new ServiceUnavailableException('Apple client IDs not configured');
    }

    let appleId: string | undefined;
    try {
      const verified = await appleSigninAuth.verifyIdToken(idToken, {
        audience: audiences as string[],
        ignoreExpiration: false,
      });
      appleId = verified.sub;
    } catch {
      throw new UnauthorizedException('Invalid Apple id_token');
    }

    if (!appleId) {
      throw new BadRequestException('Invalid Apple ID token');
    }

    // Atomic link: updateMany with `appleId: null` guard ensures we only write
    // if the field is unset. The DB unique index catches cross-user conflicts (P2002).
    let updated: { count: number };
    try {
      updated = await this.authRepository.linkAppleAccountIfUnset(
        userId,
        appleId,
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This Apple account is already linked to another user.',
        );
      }
      throw err;
    }
    if (updated.count === 0) {
      // Either user does not exist (or is soft-deleted), or appleId is already set
      const user = await this.authRepository.findActiveUserById(userId);
      if (!user) throw new NotFoundException('User not found');
      throw new BadRequestException('Apple account is already linked.');
    }

    return {
      success: true,
      message: 'Apple account linked successfully',
      statusCode: 200,
      data: null,
    };
  }

  async unlinkProvider(userId: string, provider: string) {
    if (!['google', 'apple'].includes(provider)) {
      throw new BadRequestException(
        'Invalid provider. Must be "google" or "apple".',
      );
    }

    // Wrap check-and-update in a transaction to prevent TOCTOU: two concurrent
    // unlink calls could both pass the linkedCount guard and leave the user with
    // only email (which may not be a usable login method for OAuth-only accounts).
    await this.authRepository.transaction(async (tx) => {
      const user = await tx.findActiveUserLinkedProviderFields(userId);

      if (!user) throw new NotFoundException('User not found');

      const fieldToUnlink = provider === 'google' ? 'googleId' : 'appleId';
      if (!user[fieldToUnlink]) {
        throw new BadRequestException(`${provider} account is not linked.`);
      }

      // Count linked sign-in methods: email/password only if user has a real password,
      // plus any linked OAuth providers.
      let linkedCount = user.hasLocalPassword ? 1 : 0;
      if (user.googleId) linkedCount++;
      if (user.appleId) linkedCount++;

      if (linkedCount <= 1) {
        throw new BadRequestException(
          'Cannot unlink. You must have at least one linked sign-in method.',
        );
      }

      await tx.unlinkProviderField(userId, fieldToUnlink);
    });

    return {
      success: true,
      message: `${provider} account unlinked successfully`,
      statusCode: 200,
      data: null,
    };
  }
}
