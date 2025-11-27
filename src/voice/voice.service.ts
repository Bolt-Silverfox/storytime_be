import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  UploadVoiceDto,
  VoiceResponseDto,
} from './voice.dto';

@Injectable()
export class VoiceService {
  constructor(private readonly prisma: PrismaService) { }

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
        // elevenLabsVoiceId: dto.elevenLabsVoiceId,
      },
    });
    return this.toVoiceResponse(voice);
  }

  // --- List all voices for a user ---
  async listVoices(userId: string): Promise<VoiceResponseDto[]> {
    const voices = await this.prisma.voice.findMany({ where: { userId } });
    return voices.map((v) => this.toVoiceResponse(v));
  }

  // --- Set preferred voice for a user ---
  async setPreferredVoice(
    userId: string,
    dto: SetPreferredVoiceDto,
  ): Promise<{
    id: string;
    email: string;
    name: string;
    preferredVoice: string | null;
  }> {
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredVoiceId: dto.voiceId },
    });
    return {
      id: result.id,
      email: result.email,
      name: result.name ?? '',
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

    // 2. If not found, fetch details from ElevenLabs API
    console.log(`Fetching voice ${elevenLabsId} from ElevenLabs...`);

    let voiceName = 'Imported ElevenLabs Voice';

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/voices/${elevenLabsId}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': process.env.XI_API_KEY || '',
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        voiceName = data.name; // e.g., "Clyde"
      }
    } catch (error) {
      console.warn('Failed to fetch voice name from ElevenLabs, using default.');
    }

    // 3. Save to our Database using schema fields
    const newVoice = await this.prisma.voice.create({
      data: {
        userId: userId,
        name: voiceName,
        type: 'elevenlabs',
        elevenLabsVoiceId: elevenLabsId,
        url: null,
      },
    });

    return { id: newVoice.id };
  }
}

