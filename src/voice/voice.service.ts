import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  UploadVoiceDto,
  VoiceResponseDto,
  VOICEID,
} from './voice.dto';

@Injectable()
export class VoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) { }

  // --- Upload a new voice file ---
  async uploadVoice(
    userId: string,
    fileUrl: string,
    dto: UploadVoiceDto,
  ): Promise<VoiceResponseDto> {
    const voice = await this.prisma.voice.create({
      data: {
        userId,
        name: dto.name,
        type: 'uploaded',
        url: fileUrl,
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
        type: 'elevenlabs',
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
  ): Promise<any> {
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredVoiceId: dto.voiceId },
    });
    return {
      id: result.id,
      email: result.email,
      preferredVoice: result.preferredVoiceId,
    };
  }

  // --- Get the preferred voice for a user ---
  async getPreferredVoice(userId: string): Promise<VoiceResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferredVoice: true },
    });

    if (!user || !user.preferredVoice)
      return {
        id: '',
        name: '',
        type: '',
        url: undefined,
        elevenLabsVoiceId: undefined,
      };

    return this.toVoiceResponse(user.preferredVoice);
  }

  // --- Helper to map Prisma Voice to VoiceResponseDto ---
  private toVoiceResponse(voice: any): VoiceResponseDto {
    return {
      id: voice.id,
      name: voice.name,
      type: voice.type,
      url: voice.url ?? undefined,
      elevenLabsVoiceId: voice.elevenLabsVoiceId ?? undefined,
    };
  }

 // ... inside VoiceService class ...

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

    console.log(`Fetching voice ${elevenLabsId} from ElevenLabs API...`);

    try {
      const apiKey = this.configService.get<string>('ELEVEN_LABS_KEY');
      const response = await fetch(
        `https://api.elevenlabs.io/v1/voices/${elevenLabsId}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey ?? '',
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        voiceName = data.name; // e.g., "Harry"
        voicePreviewUrl = data.preview_url; // e.g., "https://..."
      } else {
        console.warn(
          `ElevenLabs API returned ${response.status}: ${response.statusText}`,
        );
      }
    } catch (error) {
      console.warn(
        'Failed to fetch voice details from ElevenLabs, using fallback.',
        error,
      );
    }

    // 3. Fallback: If API failed, check if it's a known voice just to fix the name
    if (voiceName === 'Imported ElevenLabs Voice') {
      const knownKey = Object.keys(VOICEID).find(
        (key) => VOICEID[key as keyof typeof VOICEID] === elevenLabsId,
      );
      if (knownKey) {
        voiceName =
          knownKey.charAt(0).toUpperCase() + knownKey.slice(1).toLowerCase();
      }
    }

    // 4. Save to our Database with the URL
    const newVoice = await this.prisma.voice.create({
      data: {
        userId: userId,
        name: voiceName,
        type: 'elevenlabs',
        elevenLabsVoiceId: elevenLabsId,
        url: voicePreviewUrl,
      },
    });

    return { id: newVoice.id };
  }
}