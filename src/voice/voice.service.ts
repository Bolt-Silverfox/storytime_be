import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VOICEID, VoiceResponseDto } from '../story/story.dto'; // Importing existing constants

@Injectable()
export class VoiceService {
  constructor(private prisma: PrismaService) {}

  async getAllAvailableVoices(userId: string): Promise<VoiceResponseDto[]> {
    // 1. Define System Voices (Hardcoded based on your existing VOICIED constant)
    // These are available to everyone.
    const systemVoices: VoiceResponseDto[] = [
      { id: VOICEID.MILO, name: 'Milo', type: 'system', elevenLabsVoiceId: VOICEID.MILO },
      { id: VOICEID.BELLA, name: 'Bella', type: 'system', elevenLabsVoiceId: VOICEID.BELLA },
      { id: VOICEID.COSMO, name: 'Cosmo', type: 'system', elevenLabsVoiceId: VOICEID.COSMO },
      { id: VOICEID.NIMBUS, name: 'Nimbus', type: 'system', elevenLabsVoiceId: VOICEID.NIMBUS },
      { id: VOICEID.GRANDPA_JO, name: 'Grandpa Jo', type: 'system', elevenLabsVoiceId: VOICEID.GRANDPA_JO },
      { id: VOICEID.CHIP, name: 'Chip', type: 'system', elevenLabsVoiceId: VOICEID.CHIP },
    ];

    // 2. Fetch User-Specific Voices from DB (Cloned/Uploaded voices)
    const userVoices = await this.prisma.voice.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
    });

    // 3. Map DB voices to DTO
    const mappedUserVoices: VoiceResponseDto[] = userVoices.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type, // 'uploaded' or 'elevenlabs'
      url: v.url ?? undefined,
      elevenLabsVoiceId: v.elevenLabsVoiceId ?? undefined,
    }));

    // 4. Combine and return
    return [...systemVoices, ...mappedUserVoices];
  }
}