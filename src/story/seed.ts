import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { VOICE_CONFIG } from '../voice/voice.dto';
import { categories, defaultAgeGroups, systemAvatars, themes } from '../../prisma/data';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "stories", "_StoryCategories", "_StoryThemes", "Category", "Theme" RESTART IDENTITY CASCADE;',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "age_groups" RESTART IDENTITY CASCADE;',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "voices" RESTART IDENTITY CASCADE;',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "avatars" RESTART IDENTITY CASCADE;',
  );

  const storiesPath = path.resolve('src/story/stories.json');
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
    if (!existingVoice) {
      await prisma.voice.create({
        data: {
          elevenLabsVoiceId: config.model,
          name: key,
          type: 'deepgram',
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