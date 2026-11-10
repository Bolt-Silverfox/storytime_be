import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  CreateElevenLabsVoiceDto,
  UploadVoiceDto,
  VoiceResponseDto,
  VoiceSourceType,
} from '../dto/voice.dto';
import { UploadApiResponse } from 'cloudinary';
import { SubscriptionService } from '@/subscription/subscription.service';
import { UploadService } from '@/upload/upload.service';
import { FREE_TIER_LIMITS } from '@/shared/constants/free-tier.constants';
import { MAX_CUSTOM_VOICES_PER_USER, VOICE_CONFIG } from '../voice.constants';
import { ElevenLabsTTSProvider } from '../providers/eleven-labs-tts.provider';
import { VoiceResponseMapper } from './voice-response.mapper';
import { VOICE_REPOSITORY, IVoiceRepository } from '../repositories';
import { withResilience } from '@/shared/resilience';
import { CircuitBreakerService } from '@/shared/services/circuit-breaker.service';

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
    @Inject(VOICE_REPOSITORY)
    private readonly voiceRepository: IVoiceRepository,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly elevenLabsProvider: ElevenLabsTTSProvider,
    private readonly mapper: VoiceResponseMapper,
    private readonly cbService: CircuitBreakerService,
    private readonly subscriptionService: SubscriptionService,
    private readonly uploadService: UploadService,
  ) {}

  async uploadVoiceFile(
    userId: string,
    file: Express.Multer.File,
    dto: UploadVoiceDto,
  ): Promise<{
    voice: VoiceResponseDto;
    cloudinary: { url: string; publicId: string };
  }> {
    const isPremium = await this.subscriptionService.isPremiumUser(userId);
    if (!isPremium && FREE_TIER_LIMITS.VOICES.CUSTOM_SLOTS <= 0) {
      throw new ForbiddenException(
        'Custom voices are available on premium plans only.',
      );
    }
    const cap = isPremium
      ? MAX_CUSTOM_VOICES_PER_USER
      : FREE_TIER_LIMITS.VOICES.CUSTOM_SLOTS;

    const reserved = await this.voiceRepository.createUploadedVoiceWithinCap(
      userId,
      { userId, name: dto.name, type: VoiceSourceType.UPLOADED },
      cap,
    );
    if (!reserved) {
      throw new ForbiddenException(
        `You have reached the limit of ${cap} custom voices.`,
      );
    }

    let upload: UploadApiResponse | undefined;
    let elevenLabsId: string | undefined;
    try {
      upload = await this.uploadService.uploadFile(file);
      elevenLabsId = await this.cloneVoice(dto.name, file.buffer);
      const voice = await this.voiceRepository.updateVoice(reserved.id, {
        url: upload.secure_url,
        elevenLabsVoiceId: elevenLabsId,
      });
      return {
        voice: this.mapper.toVoiceResponse(voice),
        cloudinary: { url: upload.secure_url, publicId: upload.public_id },
      };
    } catch (error) {
      if (elevenLabsId) {
        const orphanedVoiceId = elevenLabsId;
        await this.elevenLabsProvider
          .deleteVoice(orphanedVoiceId)
          .catch((e) => {
            this.logger.error(
              `Failed to delete orphaned ElevenLabs voice ${orphanedVoiceId}: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      }
      if (upload) {
        await this.uploadService
          .deleteAudio(upload.public_id, upload.resource_type)
          .catch((e) => {
            this.logger.error(
              `Failed to delete orphaned Cloudinary file ${upload?.public_id}: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      }
      await this.voiceRepository.hardDeleteVoice(reserved.id).catch((e) => {
        this.logger.error(
          `Failed to release reserved voice ${reserved.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      throw error;
    }
  }

  private async cloneVoice(name: string, buffer: Buffer): Promise<string> {
    try {
      const id = await this.elevenLabsProvider.addVoice(name, buffer);
      this.logger.log(`Cloned voice ${name} with ID ${id}`);
      return id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to clone voice with ElevenLabs: ${msg}`);
      throw new InternalServerErrorException(
        'Voice cloning failed. Please try again later.',
      );
    }
  }

  // --- Create a voice using ElevenLabs ID ---
  async createElevenLabsVoice(
    userId: string,
    dto: CreateElevenLabsVoiceDto,
  ): Promise<VoiceResponseDto> {
    const voice = await this.voiceRepository.createVoice({
      userId,
      name: dto.name,
      type: VoiceSourceType.ELEVENLABS,
      elevenLabsVoiceId: dto.elevenLabsVoiceId,
    });
    return this.mapper.toVoiceResponse(voice);
  }

  // --- List all voices for a user ---
  async listVoices(userId: string): Promise<VoiceResponseDto[]> {
    const voices = await this.voiceRepository.findManyByUserNotDeleted(userId);
    return voices.map((v) => this.mapper.toVoiceResponse(v));
  }

  async findOrCreateElevenLabsVoice(
    elevenLabsId: string,
    userId: string,
  ): Promise<{ id: string }> {
    // 1. Check if we already have this voice locally for this user
    const existing = await this.voiceRepository.findFirstByUserAndElevenLabsId(
      userId,
      elevenLabsId,
    );

    if (existing) {
      return { id: existing.id };
    }

    // 2. Fetch details from ElevenLabs to get Name AND Preview URL
    let voiceName = 'Imported ElevenLabs Voice';
    let voicePreviewUrl: string | null = null;

    this.logger.log(`Fetching voice ${elevenLabsId} from ElevenLabs API...`);

    try {
      const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
      const response = await withResilience(
        this.cbService.getBreaker('voice-library'),
        () =>
          firstValueFrom(
            this.httpService.get(
              `https://api.elevenlabs.io/v1/voices/${elevenLabsId}`,
              {
                headers: {
                  'xi-api-key': apiKey ?? '',
                },
              },
            ),
          ),
        { retries: 2 },
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
    const newVoice = await this.voiceRepository.createVoice({
      userId: userId,
      name: voiceName,
      type: VoiceSourceType.ELEVENLABS,
      elevenLabsVoiceId: elevenLabsId,
      url: voicePreviewUrl,
      // voiceAvatar could be set here if we fetched it, or let it default in retrieval
    });

    return { id: newVoice.id };
  }
}
