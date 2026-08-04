import { Inject, Injectable, Logger } from '@nestjs/common';
import { ELEVEN_LABS_TO_VOICE_TYPE, VOICE_CONFIG } from '../voice.constants';
import { VoiceType, VOICE_TYPE_MIGRATION_MAP } from '../dto/voice.dto';
import { VOICE_REPOSITORY, IVoiceRepository } from '../repositories';

/**
 * Resolves voice identifiers between their three interchangeable forms:
 * VoiceType enum keys, Voice table UUIDs, and canonical ElevenLabs voice IDs.
 *
 * Extracted verbatim from VoiceQuotaService (resolveCanonicalVoiceId /
 * resolveVoiceUuid) so both the quota facade and downstream callers share
 * one resolution implementation, including the known-voice auto-seed.
 */
@Injectable()
export class VoiceIdResolverService {
  private readonly logger = new Logger(VoiceIdResolverService.name);

  constructor(
    @Inject(VOICE_REPOSITORY)
    private readonly voiceRepository: IVoiceRepository,
  ) {}

  /**
   * Map a stored voiceId (VoiceType enum, UUID, or elevenLabsId) to
   * its canonical ElevenLabs voice ID so comparisons are consistent.
   */
  async resolveCanonicalVoiceId(voiceId: string): Promise<string> {
    // Already a VoiceType enum key → look up elevenLabsId
    if (Object.values(VoiceType).includes(voiceId as VoiceType)) {
      return VOICE_CONFIG[voiceId as VoiceType].elevenLabsId;
    }
    // Check migration map for old enum names (CHARLIE → MILO, etc.)
    const migrated = VOICE_TYPE_MIGRATION_MAP[voiceId];
    if (migrated) {
      return VOICE_CONFIG[migrated].elevenLabsId;
    }
    // Could be a UUID from the Voice table
    const voice = await this.voiceRepository.findUniqueByIdNotDeleted(voiceId);
    if (voice?.elevenLabsVoiceId) {
      return voice.elevenLabsVoiceId;
    }
    // Already an elevenLabsId or unknown — return as-is
    return voiceId;
  }

  /**
   * Resolve an ElevenLabs voice ID to the Voice table UUID.
   * If no DB row exists but the ID belongs to a known system voice,
   * auto-creates the row so voice locking works without manual seeding.
   */
  async resolveVoiceUuid(elevenLabsVoiceId: string): Promise<string | null> {
    const voice =
      await this.voiceRepository.findSystemVoiceIdByElevenLabsId(
        elevenLabsVoiceId,
      );
    if (voice) return voice.id;

    // Auto-seed from VOICE_CONFIG if this is a known system voice
    const voiceTypeKey = ELEVEN_LABS_TO_VOICE_TYPE.get(elevenLabsVoiceId);
    if (!voiceTypeKey) return null;

    const key = voiceTypeKey;
    const config = VOICE_CONFIG[voiceTypeKey];
    const created = await this.voiceRepository.createVoiceReturningId({
      elevenLabsVoiceId: config.elevenLabsId,
      name: key,
      type: 'elevenlabs',
      voiceAvatar: config.voiceAvatar,
      url: config.previewUrl,
      isDeleted: false,
      userId: null,
    });
    this.logger.log(
      `Auto-seeded voice ${key} (${elevenLabsVoiceId}) with UUID ${created.id}`,
    );
    return created.id;
  }
}
