import { VOICE_CONFIG } from '../../src/voice/voice.constants';
import { SeedContext, SeedResult } from './types';

export async function seedVoices(ctx: SeedContext): Promise<SeedResult> {
  const { prisma, logger } = ctx;

  try {
    logger.log('Seeding voices...');

    let created = 0;
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      for (const [key, config] of Object.entries(VOICE_CONFIG)) {
        const voiceData = {
          elevenLabsVoiceId: config.elevenLabsId,
          name: key,
          type: 'elevenlabs',
          voiceAvatar: config.voiceAvatar,
          url: config.previewUrl,
          isDeleted: false,
        };

        // Deterministic lookup: prefer elevenLabsVoiceId match, then name
        const byElevenLabsId = await tx.voice.findFirst({
          where: { elevenLabsVoiceId: config.elevenLabsId, userId: null },
        });
        const existing =
          byElevenLabsId ??
          (await tx.voice.findFirst({
            where: { name: key, userId: null },
          }));

        if (existing) {
          await tx.voice.update({
            where: { id: existing.id },
            data: voiceData,
          });
          updated++;
        } else {
          await tx.voice.create({
            data: {
              ...voiceData,
              userId: null,
            },
          });
          created++;
        }
      }
    });

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
