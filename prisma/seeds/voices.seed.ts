import { VOICE_CONFIG } from '../../src/voice/voice.constants';
import { SeedContext, SeedResult } from './types';

export async function seedVoices(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding voices...');

    let created = 0;
    let updated = 0;

    for (const [key, config] of Object.entries(VOICE_CONFIG)) {
      const voiceData = {
        elevenLabsVoiceId: config.elevenLabsId,
        name: key,
        type: 'elevenlabs',
        voiceAvatar: config.voiceAvatar,
        url: config.previewUrl,
        isDeleted: false,
      };

      // Find by name OR elevenLabsVoiceId to catch all duplicates
      const existing = await prisma.voice.findFirst({
        where: {
          OR: [
            { name: key, userId: null },
            { elevenLabsVoiceId: config.elevenLabsId, userId: null },
          ],
        },
      });

      if (existing) {
        await prisma.voice.update({
          where: { id: existing.id },
          data: voiceData,
        });
        updated++;
      } else {
        await prisma.voice.create({
          data: {
            ...voiceData,
            userId: null,
          },
        });
        created++;
      }
    }

    logger.success(
      `Seeded voices: ${created} created, ${updated} updated (${created + updated} total)`,
    );

    return {
      name: 'voices',
      success: true,
      count: created + updated,
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
