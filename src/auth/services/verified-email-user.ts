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
}

export interface VerifiedEmailDeps {
  authRepository: IAuthRepository;
  passwordService: Pick<PasswordService, 'hashPassword'>;
}

export async function findOrCreateParentByVerifiedEmail(
  deps: VerifiedEmailDeps,
  input: VerifiedEmailInput,
): Promise<{ user: UserWithProfileAndAvatar; isNewUser: boolean }> {
  const { authRepository, passwordService } = deps;
  const { email, name, emailVerified, googleId, appleId, onboardingStatus } =
    input;

  const existing = await authRepository.findUserByEmail(email);
  if (existing) {
    const user = await authRepository.updateUserWithRelations(existing.id, {
      isEmailVerified: emailVerified ? true : existing.isEmailVerified,
      googleId: googleId || existing.googleId,
      appleId: appleId || existing.appleId,
    });
    return { user, isNewUser: false };
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
  return { user, isNewUser: true };
}
