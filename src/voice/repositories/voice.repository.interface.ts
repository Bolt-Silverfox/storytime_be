import type { Voice, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IVoiceRepository {
  // Create a voice record and return the full row
  createVoice(data: Prisma.VoiceUncheckedCreateInput): Promise<Voice>;

  // Create a voice record, selecting only its id
  createVoiceReturningId(
    data: Prisma.VoiceUncheckedCreateInput,
  ): Promise<{ id: string }>;

  // List a user's non-deleted voices
  findManyByUserNotDeleted(userId: string): Promise<Voice[]>;

  // Find a user's non-deleted voice by its ElevenLabs voice id
  findFirstByUserAndElevenLabsId(
    userId: string,
    elevenLabsVoiceId: string,
  ): Promise<Voice | null>;

  // Find a non-deleted system voice (userId null) by its ElevenLabs voice id
  findSystemVoiceByElevenLabsId(
    elevenLabsVoiceId: string,
  ): Promise<Voice | null>;

  // Find a non-deleted voice by id
  findFirstByIdNotDeleted(id: string): Promise<Voice | null>;

  // Find non-deleted system voices (userId null) by a set of ElevenLabs voice ids
  findSystemVoicesByElevenLabsIds(
    elevenLabsVoiceIds: string[],
  ): Promise<Voice[]>;

  // Find a non-deleted voice by id (findUnique semantics)
  findUniqueByIdNotDeleted(id: string): Promise<Voice | null>;

  // Find a non-deleted system voice id (userId null) by its ElevenLabs voice id
  findSystemVoiceIdByElevenLabsId(
    elevenLabsVoiceId: string,
  ): Promise<{ id: string } | null>;

  // Find id + elevenLabsVoiceId pairs for a set of voice ids
  findVoiceIdElevenLabsPairs(
    ids: string[],
  ): Promise<Array<{ id: string; elevenLabsVoiceId: string | null }>>;

  // Find the elevenLabsVoiceId for a non-deleted voice by id
  findElevenLabsIdById(
    id: string,
  ): Promise<{ elevenLabsVoiceId: string | null } | null>;
}

export const VOICE_REPOSITORY = Symbol('VOICE_REPOSITORY');
