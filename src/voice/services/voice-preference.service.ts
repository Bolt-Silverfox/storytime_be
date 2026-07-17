import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Voice } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SetPreferredVoiceDto,
  VoiceResponseDto,
  VoiceSourceType,
  VoiceType,
  VOICE_TYPE_MIGRATION_MAP,
} from '../dto/voice.dto';
import { VOICE_CONFIG } from '../voice.constants';
import { VoiceResponseMapper } from './voice-response.mapper';

/**
 * Manages a parent's preferred (default) voice selection.
 *
 * Extracted verbatim from VoiceService (setPreferredVoice / getPreferredVoice).
 */
@Injectable()
export class VoicePreferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: VoiceResponseMapper,
  ) {}

  // --- Set preferred voice for a user (Parent) ---
  async setPreferredVoice(
    userId: string,
    dto: SetPreferredVoiceDto,
  ): Promise<VoiceResponseDto> {
    let voice: Voice | null;

    // Check if the voiceId is a VoiceType enum key (e.g. "NIMBUS") or migrated name
    let voiceTypeKey = dto.voiceId as VoiceType;
    const migrated = VOICE_TYPE_MIGRATION_MAP[dto.voiceId];
    if (migrated) {
      voiceTypeKey = migrated;
    }

    if (Object.values(VoiceType).includes(voiceTypeKey)) {
      const config = VOICE_CONFIG[voiceTypeKey];
      voice = await this.prisma.voice.findFirst({
        where: {
          elevenLabsVoiceId: config.elevenLabsId,
          userId: null,
          isDeleted: false,
        },
      });
    } else {
      voice = await this.prisma.voice.findFirst({
        where: { id: dto.voiceId, isDeleted: false },
      });
    }

    if (!voice) {
      throw new NotFoundException(
        `Voice "${dto.voiceId}" not found. Please select a valid voice.`,
      );
    }

    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredVoiceId: voice.id },
      include: { preferredVoice: true },
    });

    if (!result.preferredVoice) {
      throw new InternalServerErrorException(
        'Preferred voice was set but could not be loaded.',
      );
    }

    return this.mapper.toVoiceResponseWithKey(result.preferredVoice);
  }

  // --- Get the preferred voice for a user ---
  async getPreferredVoice(userId: string): Promise<VoiceResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferredVoice: true },
    });

    if (!user || !user.preferredVoice) {
      return {
        id: 'default',
        name: 'default',
        displayName: 'Default Voice',
        type: VoiceSourceType.ELEVENLABS,
        previewUrl: undefined,
        voiceAvatar: undefined,
        elevenLabsVoiceId: undefined,
      };
    }

    return this.mapper.toVoiceResponseWithKey(user.preferredVoice);
  }
}
