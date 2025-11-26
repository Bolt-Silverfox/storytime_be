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
  constructor(private readonly prisma: PrismaService) {}

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
}
