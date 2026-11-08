import * as crypto from 'crypto';
import { Role } from '@prisma/client';
import type {
  IAuthRepository,
  UserWithProfileAndAvatar,
} from '../repositories';
import type { PasswordService } from './password.service';
import { AccountAlreadyVerifiedError } from '../repositories/account-already-verified.error';

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

const isEmailUniqueViolation = (error: unknown): boolean => {
  const { code, meta } = (error ?? {}) as {
    code?: string;
    meta?: { target?: unknown };
  };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  return Array.isArray(target)
    ? target.includes('email')
    : typeof target === 'string' && target.includes('email');
};

export function findOrCreateParentByVerifiedEmail(
  deps: VerifiedEmailDeps,
  input: VerifiedEmailInput,
): Promise<VerifiedEmailResult> {
  return resolveParent(deps, input, true);
}

async function resolveParent(
  deps: VerifiedEmailDeps,
  input: VerifiedEmailInput,
  canRetry: boolean,
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

    let current = existing;
    if (emailVerified && !existing.isEmailVerified) {
      const passwordHash = await passwordService.hashPassword(
        crypto.randomBytes(16).toString('hex'),
      );
      try {
        const user = await authRepository.takeOverUnverifiedAccount(
          existing.id,
          {
            passwordHash,
            hasLocalPassword: false,
            pinHash: null,
            biometricsEnabled: false,
            isEmailVerified: true,
            googleId: googleId ?? null,
            appleId: appleId ?? null,
            ...(onboardingStatus ? { onboardingStatus } : {}),
          },
        );
        return { user, isNewUser: false, newlyVerified: true };
      } catch (error) {
        if (!(error instanceof AccountAlreadyVerifiedError)) throw error;
        current = (await authRepository.findUserById(existing.id)) ?? existing;
      }
    }

    if (emailVerified && !current.isEmailVerified) {
      await authRepository.updateUserWithRelations(current.id, {
        isEmailVerified: true,
      });
    }
    if (googleId) {
      await authRepository.linkGoogleAccountIfUnset(current.id, googleId);
    }
    if (appleId) {
      await authRepository.linkAppleAccountIfUnset(current.id, appleId);
    }
    const user = (await authRepository.findUserByIdWithProfile(current.id)) ?? {
      ...current,
      profile: null,
      avatar: null,
    };
    return { user, isNewUser: false, newlyVerified: false };
  }

  const randomPassword = crypto.randomBytes(16).toString('hex');
  const hashedPassword = await passwordService.hashPassword(randomPassword);

  try {
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
  } catch (error) {
    if (canRetry && isEmailUniqueViolation(error)) {
      return resolveParent(deps, input, false);
    }
    throw error;
  }
}
