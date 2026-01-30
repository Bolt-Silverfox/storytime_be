import { VOICE_CONFIG } from '../../src/voice/voice.constants';
import { SeedContext, SeedResult } from './types';

export async function seedVoices(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding voices...');

    let count = 0;
    for (const [key, config] of Object.entries(VOICE_CONFIG)) {
      const existingVoice = await prisma.voice.findFirst({
        where: { name: key },
      });

      const voiceData = {
        elevenLabsVoiceId: config.elevenLabsId,
        name: key,
        type: 'elevenlabs',
        voiceAvatar: config.voiceAvatar,
        url: config.previewUrl,
      };

      if (existingVoice) {
        await prisma.voice.update({
          where: { id: existingVoice.id },
          data: voiceData,
        });
      } else {
        await prisma.voice.create({
          data: {
            ...voiceData,
            userId: null,
          },
        });
      }
      count++;
    }

    logger.success(`Seeded ${count} voices`);

    return {
      name: 'voices',
      success: true,
      count,
    };
  } catch (error) {
    logger.error('Failed to seed voices', error);
    return {
      name: 'voices',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
