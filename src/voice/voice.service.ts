import {
  Injectable,
  Logger,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import {
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  UploadVoiceDto,
  VoiceResponseDto,
  VoiceSourceType,
} from './dto/voice.dto';
import { VOICE_CONFIG } from './voice.constants';
import { ElevenLabsTTSProvider } from './providers/eleven-labs-tts.provider';
import type { Voice } from '@prisma/client';

/** Cache key for available voices */
const AVAILABLE_VOICES_CACHE_KEY = 'available-voices';
/** Cache TTL: 5 minutes (voices rarely change) */
const VOICES_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // --- Upload a new voice file ---
  async uploadVoice(
    userId: string,
    fileUrl: string,
    dto: UploadVoiceDto,
    fileBuffer?: Buffer,
  ): Promise<VoiceResponseDto> {
    let elevenLabsId = '';

    if (fileBuffer) {
      try {
        elevenLabsId = await this.elevenLabsProvider.addVoice(
          dto.name,
          fileBuffer,
        );
        this.logger.log(`Cloned voice ${dto.name} with ID ${elevenLabsId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to clone voice with ElevenLabs: ${msg}`);
        throw new InternalServerErrorException(`Voice cloning failed: ${msg}`);
      }
    }

    const voice = await this.prisma.voice.create({
      data: {
        userId,
        name: dto.name,
        type: VoiceSourceType.UPLOADED,
        url: fileUrl,
        elevenLabsVoiceId: elevenLabsId || null,
      },
    });
    return this.toVoiceResponse(voice);
  }

  // --- Create a voice using ElevenLabs ID ---
  async createElevenLabsVoice(
    userId: string,
    dto: CreateElevenLabsVoiceDto,
  ): Promise<VoiceResponseDto> {
    const voice = await this.prisma.voice.create({
      data: {
        userId,
        name: dto.name,
        type: VoiceSourceType.ELEVENLABS,
        elevenLabsVoiceId: dto.elevenLabsVoiceId,
      },
    });
    return this.toVoiceResponse(voice);
  }

  // --- List all voices for a user ---
  async listVoices(userId: string): Promise<VoiceResponseDto[]> {
    const voices = await this.prisma.voice.findMany({ where: { userId } });
    return voices.map((v) => this.toVoiceResponse(v));
  }

  // --- Set preferred voice for a user (Parent) ---
  async setPreferredVoice(
    userId: string,
    dto: SetPreferredVoiceDto,
  ): Promise<VoiceResponseDto> {
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredVoiceId: dto.voiceId },
      include: { preferredVoice: true },
    });

    if (!result.preferredVoice) {
      throw new Error('Preferred voice not found');
    }

    return this.toVoiceResponse(result.preferredVoice);
  }

  // --- Get the preferred voice for a user ---
  async getPreferredVoice(userId: string): Promise<VoiceResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferredVoice: true },
    });

    if (!user || !user.preferredVoice) {
      return {
        id: '',
        name: '',
        displayName: '',
        type: '',
        previewUrl: undefined,
        voiceAvatar: undefined,
        elevenLabsVoiceId: undefined,
      };
    }

    return this.toVoiceResponse(user.preferredVoice);
  }

  // --- Helper to map Prisma Voice to VoiceResponseDto ---
  private toVoiceResponse(voice: Voice): VoiceResponseDto {
    let previewUrl = voice.url ?? undefined;
    let voiceAvatar = voice.voiceAvatar ?? undefined;

    // Lookup VOICE_CONFIG for display name
    const config = voice.elevenLabsVoiceId
      ? Object.values(VOICE_CONFIG).find(
          (c) => c.elevenLabsId === voice.elevenLabsVoiceId,
        )
      : undefined;

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

  async findOrCreateElevenLabsVoice(
    elevenLabsId: string,
    userId: string,
  ): Promise<{ id: string }> {
    // 1. Check if we already have this voice locally for this user
    const existing = await this.prisma.voice.findFirst({
      where: {
        userId: userId,
        elevenLabsVoiceId: elevenLabsId,
      },
    });

    if (existing) {
      return { id: existing.id };
    }

    // 2. Fetch details from ElevenLabs to get Name AND Preview URL
    let voiceName = 'Imported ElevenLabs Voice';
    let voicePreviewUrl: string | null = null;

    this.logger.log(`Fetching voice ${elevenLabsId} from ElevenLabs API...`);

    try {
      const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
      const response = await firstValueFrom(
        this.httpService.get(
          `https://api.elevenlabs.io/v1/voices/${elevenLabsId}`,
          {
            headers: {
              'xi-api-key': apiKey ?? '',
            },
          },
        ),
      );

      if (response.status === 200) {
        const data = response.data;
        voiceName = data.name; // e.g., "Harry"
        voicePreviewUrl = data.preview_url; // e.g., "https://..."
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to fetch voice details from ElevenLabs: ${msg}`);
    }

    // 3. Fallback: If API failed, check if it's a known voice just to fix the name
    if (voiceName === 'Imported ElevenLabs Voice') {
      const knownKey = Object.keys(VOICE_CONFIG).find(
        (key) =>
          VOICE_CONFIG[key as keyof typeof VOICE_CONFIG].elevenLabsId ===
          elevenLabsId, // Changed to match ID not model
      );
      if (knownKey) {
        const config = VOICE_CONFIG[knownKey as keyof typeof VOICE_CONFIG];
        voiceName =
          config.name ||
          knownKey.charAt(0).toUpperCase() + knownKey.slice(1).toLowerCase();
        if (!voicePreviewUrl) voicePreviewUrl = config.previewUrl || null;
      }
    }

    // 4. Save to our Database with the URL
    const newVoice = await this.prisma.voice.create({
      data: {
        userId: userId,
        name: voiceName,
        type: VoiceSourceType.ELEVENLABS,
        elevenLabsVoiceId: elevenLabsId,
        url: voicePreviewUrl,
        // voiceAvatar could be set here if we fetched it, or let it default in retrieval
      },
    });

    return { id: newVoice.id };
  }

  /**
   * Fetch available system voices with caching
   * Cached for 5 minutes since voices rarely change
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

    // Fetch actual records from DB to get UUIDs
    const dbVoices = await this.prisma.voice.findMany({
      where: {
        elevenLabsVoiceId: { in: systemIds },
        userId: null,
        isDeleted: false,
      },
    });

    const voices = dbVoices.map((voice) => this.toVoiceResponse(voice));

    // Cache the result
    await this.cacheManager.set(
      AVAILABLE_VOICES_CACHE_KEY,
      voices,
      VOICES_CACHE_TTL_MS,
    );

    return voices;
  }
}
