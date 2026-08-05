import { Injectable } from '@nestjs/common';
import type { Voice } from '@prisma/client';
import { VoiceResponseDto, VoiceSourceType } from '../dto/voice.dto';
import { ELEVEN_LABS_TO_VOICE_TYPE, VOICE_CONFIG } from '../voice.constants';

/**
 * Maps persisted {@link Voice} records to the API-facing {@link VoiceResponseDto}.
 *
 * Extracted verbatim from VoiceService so the catalog, library and preference
 * services can share the same mapping/preview/avatar fallback logic.
 */
@Injectable()
export class VoiceResponseMapper {
  // Find the VOICE_CONFIG entry and VoiceType key for a given elevenLabsId.
  findVoiceConfig(elevenLabsId: string | null) {
    if (!elevenLabsId) return undefined;
    const key = ELEVEN_LABS_TO_VOICE_TYPE.get(elevenLabsId);
    return key ? { key, config: VOICE_CONFIG[key] } : undefined;
  }

  // Resolve DB UUID to VoiceType key so mobile can match against available voices.
  // Used by both setPreferredVoice and getPreferredVoice for consistent ids.
  toVoiceResponseWithKey(voice: Voice): VoiceResponseDto {
    const response = this.toVoiceResponse(voice);
    const match = this.findVoiceConfig(voice.elevenLabsVoiceId);
    if (match) {
      response.id = match.key;
    }
    return response;
  }

  toVoiceResponse(voice: Voice): VoiceResponseDto {
    let previewUrl = voice.url ?? undefined;
    let voiceAvatar = voice.voiceAvatar ?? undefined;

    const config = this.findVoiceConfig(voice.elevenLabsVoiceId)?.config;

    // If it's an uploaded voice, the 'url' is the preview/audio itself
    if (voice.type === (VoiceSourceType.UPLOADED as string)) {
      previewUrl = voice.url ?? undefined;
      // Use a default avatar for uploaded voices if none exists
      if (!voiceAvatar) {
        voiceAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${voice.name}`;
      }
    } else if (voice.type === (VoiceSourceType.ELEVENLABS as string)) {
      // For ElevenLabs, fall back to VOICE_CONFIG, then dicebear
      previewUrl = voice.url || config?.previewUrl;
      if (!voiceAvatar) {
        voiceAvatar =
          config?.voiceAvatar ??
          `https://api.dicebear.com/7.x/identicon/svg?seed=${voice.elevenLabsVoiceId}`;
      }
    }

    return {
      id: voice.id,
      name: voice.name,
      displayName: config?.name ?? voice.name,
      type: voice.type,
      previewUrl,
      voiceAvatar,
      elevenLabsVoiceId: voice.elevenLabsVoiceId ?? undefined,
    };
  }
}
