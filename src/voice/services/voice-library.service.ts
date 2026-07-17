import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateElevenLabsVoiceDto,
  UploadVoiceDto,
  VoiceResponseDto,
  VoiceSourceType,
} from '../dto/voice.dto';
import { VOICE_CONFIG } from '../voice.constants';
import { ElevenLabsTTSProvider } from '../providers/eleven-labs-tts.provider';
import { VoiceResponseMapper } from './voice-response.mapper';

/**
 * Owns a user's personal voice library: uploaded clones, registered ElevenLabs
 * voices, listing and lazy import of ElevenLabs voices.
 *
 * Extracted verbatim from VoiceService.
 */
@Injectable()
export class VoiceLibraryService {
  private readonly logger = new Logger(VoiceLibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly mapper: VoiceResponseMapper,
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
        throw new InternalServerErrorException(
          'Voice cloning failed. Please try again later.',
        );
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
    return this.mapper.toVoiceResponse(voice);
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
    return this.mapper.toVoiceResponse(voice);
  }

  // --- List all voices for a user ---
  async listVoices(userId: string): Promise<VoiceResponseDto[]> {
    const voices = await this.prisma.voice.findMany({
      where: { userId, isDeleted: false },
    });
    return voices.map((v) => this.mapper.toVoiceResponse(v));
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
        isDeleted: false,
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
}
