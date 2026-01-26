import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { VoiceType } from '../voice/dto/voice.dto';
import { VOICE_CONFIG } from '../voice/voice.constants';
import { categories, defaultAgeGroups, systemAvatars, themes, learningExpectations, seasons } from '../../prisma/data';

const prisma = new PrismaClient();

async function main() {
  // Idempotent seeding: We removed TRUNCATE statements to preserve existing data (Users, Kids, etc.)
  // Use db:reset if you need to wipe the database.

  const storiesPath = path.resolve('prisma/data/stories.json');
  const getStories = () => {
    return JSON.parse(fs.readFileSync(storiesPath, 'utf-8'));
  };
  const stories = getStories();

  // We do this first so the "Main" categories have beautiful images/descriptions
  console.log('Seeding master categories...');
  await prisma.category.createMany({
    data: categories,
    skipDuplicates: true,
  });

  console.log('Seeding master themes...');
  await prisma.theme.createMany({
    data: themes,
    skipDuplicates: true,
  });

  console.log('Seeding age groups...');
  for (const group of defaultAgeGroups) {
    await prisma.ageGroup.upsert({
      where: { name: group.name },
      update: { min: group.min, max: group.max },
      create: { name: group.name, min: group.min, max: group.max },
    });
  }

  // ADD THIS SECTION - Seed Learning Expectations
  console.log('Seeding learning expectations...');
  for (const expectation of learningExpectations) {
    await prisma.learningExpectation.upsert({
      where: { name: expectation.name },
      update: {
        description: expectation.description,
        isActive: true,
      },
      create: expectation,
    });
  }
  console.log('Learning expectations seeded!');

  // Seed Seasons
  console.log('Seeding seasons...');
  for (const season of seasons) {
    await prisma.season.upsert({
      where: { name: season.name },
      update: {
        description: season.description,
        startDate: season.startDate,
        endDate: season.endDate,
        isActive: true,
      },
      create: {
        name: season.name,
        description: season.description,
        startDate: season.startDate,
        endDate: season.endDate,
        isActive: true,
      },
    });
  }
  console.log('Seasons seeded!');

  // 6. Seed Stories with "connectOrCreate"
  console.log('Seeding stories...');
  for (const story of stories) {
    // Ensure we handle both strings and arrays
    const storyCategories = Array.isArray(story.category)
      ? story.category
      : [story.category];

    // Filter out empty strings if any
    const cleanCategories = storyCategories.filter((c: string) => c && c.length > 0);

    const storyThemes = Array.isArray(story.theme) ? story.theme : [story.theme];
    const cleanThemes = storyThemes.filter((t: string) => t && t.length > 0);

    await prisma.story.create({
      data: {
        title: story.title,
        description: story.description,
        language: story.language,
        coverImageUrl: story.coverImageUrl,
        audioUrl: story.audioUrl ?? '',
        isInteractive: story.isInteractive ?? false,
        ageMin: story.ageMin ?? 0,
        ageMax: story.ageMax ?? 9,
        textContent: story.content,
        recommended: story.recommended ?? false,
        backgroundColor: story.backgroundColor || '#5E3A54',
        categories: {
          connectOrCreate: cleanCategories.map((name: string) => ({
            where: { name: name },
            create: {
              name: name,
              description: 'Auto-generated category'
            },
          })),
        },
        themes: {
          connectOrCreate: cleanThemes.map((name: string) => ({
            where: { name: name },
            create: {
              name: name,
              description: 'Auto-generated theme'
            },
          })),
        },
        seasons: story['seasons']
          ? {
            connect: story['seasons'].map((name: string) => ({ name })),
          }
          : undefined,

        questions: {
          create: story.questions.map((question: any) => ({
            question: question.question,
            options: question.options,
            correctOption: question.correctOption,
          })),
        },
      },
    });
  }
  console.log('Seeded stories!');

  // 7. Seed Voices
  console.log('Seeding voices...');
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
  }

  // 8. Seed Avatars
  console.log('Seeding avatars...');
  const existingAvatars = await prisma.avatar.findMany({
    where: { name: { in: systemAvatars.map((a) => a.name) } },
    select: { name: true },
  });
  const existingNames = new Set(existingAvatars.map((a) => a.name));
  const avatarsToCreate = systemAvatars.filter(
    (avatar) => !existingNames.has(avatar.name),
  );

  for (const avatarData of avatarsToCreate) {
    await prisma.avatar.create({
      data: {
        name: avatarData.name,
        url: avatarData.url,
        isSystemAvatar: true,
        isDeleted: false,
        deletedAt: null,
      },
    });
  }
  console.log('Seeding completed!');
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());