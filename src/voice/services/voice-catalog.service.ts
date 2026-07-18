import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { VoiceResponseDto, VoiceSourceType } from '../dto/voice.dto';
import { VOICE_CONFIG } from '../voice.constants';
import { VOICE_REPOSITORY, IVoiceRepository } from '../repositories';

/** Cache key for available voices */
const AVAILABLE_VOICES_CACHE_KEY = 'available-voices';
/** Cache TTL: 5 minutes (voices rarely change) */
const VOICES_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Owns the config-driven catalog of system voices exposed via `GET /voice/available`.
 *
 * Extracted verbatim from VoiceService.fetchAvailableVoices — same cache key,
 * TTL and DB-lookup semantics.
 */
@Injectable()
export class VoiceCatalogService {
  private readonly logger = new Logger(VoiceCatalogService.name);

  constructor(
    @Inject(VOICE_REPOSITORY)
    private readonly voiceRepository: IVoiceRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Fetch available system voices with caching.
   *
   * Config-driven: always returns all voices from VOICE_CONFIG.
   * DB records are used to attach UUIDs when available; if a voice
   * isn't seeded in the DB, the VoiceType enum key is used as the id
   * (TTS endpoints accept both UUIDs and VoiceType enum values).
   */
  async fetchAvailableVoices(): Promise<VoiceResponseDto[]> {
    // Check cache first
    const cached = await this.cacheManager.get<VoiceResponseDto[]>(
      AVAILABLE_VOICES_CACHE_KEY,
    );
    if (cached) {
      this.logger.debug('Returning cached available voices');
      return cached;
    }

    // Get the IDs we expect from config
    const systemIds = Object.values(VOICE_CONFIG).map((c) => c.elevenLabsId);

    // Fetch DB records to get UUIDs (best-effort — voices work without DB rows)
    const dbVoices =
      await this.voiceRepository.findSystemVoicesByElevenLabsIds(systemIds);

    // Index DB voices by elevenLabsId for O(1) lookup
    const dbVoiceMap = new Map(dbVoices.map((v) => [v.elevenLabsVoiceId, v]));

    // Build response from VOICE_CONFIG (guaranteed all 8 voices)
    const voices: VoiceResponseDto[] = Object.entries(VOICE_CONFIG).map(
      ([key, config]) => {
        const dbVoice = dbVoiceMap.get(config.elevenLabsId);
        return {
          id: key,
          name: key,
          displayName: config.name,
          type: VoiceSourceType.ELEVENLABS,
          previewUrl: dbVoice?.url ?? config.previewUrl,
          voiceAvatar: dbVoice?.voiceAvatar ?? config.voiceAvatar,
          elevenLabsVoiceId: config.elevenLabsId,
        };
      },
    );

    // Cache the result
    await this.cacheManager.set(
      AVAILABLE_VOICES_CACHE_KEY,
      voices,
      VOICES_CACHE_TTL_MS,
    );

    return voices;
  }
}
