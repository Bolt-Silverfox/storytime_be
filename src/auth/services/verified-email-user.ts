import * as crypto from 'crypto';
import { Role } from '@prisma/client';
import type {
  IAuthRepository,
  UserWithProfileAndAvatar,
} from '../repositories';
import type { PasswordService } from './password.service';

export interface VerifiedEmailInput {
  email: string;
  name?: string | null;
  emailVerified: boolean;
  googleId?: string;
  appleId?: string;
  onboardingStatus?: string;
  refuseInactive?: boolean;
  matchEmailCaseInsensitively?: boolean;
}

export interface VerifiedEmailDeps {
  authRepository: IAuthRepository;
  passwordService: Pick<PasswordService, 'hashPassword'>;
}

export interface VerifiedEmailResult {
  user: UserWithProfileAndAvatar;
  isNewUser: boolean;
  newlyVerified: boolean;
}

export async function findOrCreateParentByVerifiedEmail(
  deps: VerifiedEmailDeps,
  input: VerifiedEmailInput,
): Promise<VerifiedEmailResult> {
  const { authRepository, passwordService } = deps;
  const { email, name, emailVerified, googleId, appleId, onboardingStatus } =
    input;

  const existing = input.matchEmailCaseInsensitively
    ? await authRepository.findUserByEmailInsensitive(email)
    : await authRepository.findUserByEmail(email);

  if (existing) {
    if (input.refuseInactive && (existing.isSuspended || existing.isDeleted)) {
      return {
        user: { ...existing, profile: null, avatar: null },
        isNewUser: false,
        newlyVerified: false,
      };
    }

    const takeover = emailVerified && !existing.isEmailVerified;
    const hardened: {
      passwordHash?: string;
      hasLocalPassword?: boolean;
      onboardingStatus?: string;
    } = {};
    if (takeover) {
      await authRepository.deleteAllUserSessions(existing.id);
      hardened.passwordHash = await passwordService.hashPassword(
        crypto.randomBytes(16).toString('hex'),
      );
      hardened.hasLocalPassword = false;
      if (onboardingStatus) hardened.onboardingStatus = onboardingStatus;
    }

    const user = await authRepository.updateUserWithRelations(existing.id, {
      ...hardened,
      isEmailVerified: emailVerified ? true : existing.isEmailVerified,
      googleId: googleId || existing.googleId,
      appleId: appleId || existing.appleId,
    });
    return { user, isNewUser: false, newlyVerified: takeover };
  }

  const randomPassword = crypto.randomBytes(16).toString('hex');
  const hashedPassword = await passwordService.hashPassword(randomPassword);

  const user = await authRepository.createUser({
    name: name || email || 'User',
    email,
    passwordHash: hashedPassword,
    isEmailVerified: emailVerified === true,
    googleId: googleId || null,
    appleId: appleId || null,
    role: Role.parent,
    ...(onboardingStatus ? { onboardingStatus } : {}),
    profile: {
      create: {
        country: 'NG',
      },
    },
  });
  return { user, isNewUser: true, newlyVerified: false };
}
