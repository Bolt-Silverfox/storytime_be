import type { Prisma } from '@prisma/client';

// ==================== Types ====================
export type UserWithPreferredVoice = Prisma.UserGetPayload<{
  include: { preferredVoice: true };
}>;

// ==================== Repository Interface ====================
export interface IVoiceUserRepository {
  // Set a user's preferred voice and return the user with the loaded relation
  updatePreferredVoiceWithInclude(
    userId: string,
    voiceId: string,
  ): Promise<UserWithPreferredVoice>;

  // Find a user with their preferred voice relation loaded
  findByIdWithPreferredVoice(
    userId: string,
  ): Promise<UserWithPreferredVoice | null>;

  // Find only a user's preferredVoiceId
  findPreferredVoiceId(
    userId: string,
  ): Promise<{ preferredVoiceId: string | null } | null>;
}

export const VOICE_USER_REPOSITORY = Symbol('VOICE_USER_REPOSITORY');
