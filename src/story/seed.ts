import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { VOICEID } from './story.dto';
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

  // Load stories from stories.json
  const storiesPath = path.resolve('src/story/stories.json');
  const getStories = () => {
    return JSON.parse(fs.readFileSync(storiesPath, 'utf-8'));
  };

  const stories = getStories();

  await prisma.category.createMany({
    data: categories,
    skipDuplicates: true,
  });

  await prisma.theme.createMany({
    data: themes,
    skipDuplicates: true,
  });

  // Before the loop, keep your master arrays:
  const categoriesArray = categories; // your master categories array
  const themesArray = themes; // your master themes array

  console.log('Seeding age groups...');

  for (const group of defaultAgeGroups) {
    await prisma.ageGroup.upsert({
      where: { name: group.name },
      update: {
        min: group.min,
        max: group.max,
      },
      create: {
        name: group.name,
        min: group.min,
        max: group.max,
      },
    });

    console.log(`Upserted age group: ${group.name}`);
  }

  console.log('Age group seeding completed!');

  console.log('Seeding stories');
  for (const story of stories) {
    // Support both single and array for category/theme
    const categories = Array.isArray(story.category)
      ? story.category
      : [story.category];
    const themes = Array.isArray(story.theme) ? story.theme : [story.theme];
    const validCategories = categories.filter((name: string) =>
      categoriesArray.some((cat) => cat.name === name),
    );
    const validThemes = themes.filter((name: string) =>
      themesArray.some((theme) => theme.name === name),
    );
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
        categories: {
          connect: validCategories.map((name: string) => ({ name })),
        },
        themes: { connect: validThemes.map((name: string) => ({ name })) },
        textContent: story.content,
        questions: {
          create: story.questions.map((question: any) => ({
            question: question.question,
            options: question.options,
            correctOption: question.correctOption,
          })),
        },
        recommended: story.recommended ?? false,
      },
    });
  }

  console.log('Seeded stories!');

  console.log('seeding voices');
  for (const [key, voice] of Object.entries(VOICEID)) {
    // check for existing voice by elevenLabsVoiceId = voice and create if not exists
    console.log(`Seeding voice: ${key} with ID: ${voice}`);

    const existingVoice = await prisma.voice.findFirst({
      where: { elevenLabsVoiceId: voice },
    });
    if (existingVoice) {
      console.log(`Voice ${key} already exists, skipping.`);
      continue;
    }
    await prisma.voice.create({
      data: {
        elevenLabsVoiceId: voice,
        name: key,
        type: 'elevenlabs',
      },
    });
  }
  console.log('Seeded voices!');


  const existingAvatars = await prisma.avatar.findMany({
    where: {
      name: {
        in: systemAvatars.map((a) => a.name),
      },
    },
    select: {
      name: true,
    },
  });

  const existingNames = new Set(existingAvatars.map((a: typeof existingAvatars[0]) => a.name));

  // Filter out avatars that already exist
  const avatarsToCreate = systemAvatars.filter(
    (avatar) => !existingNames.has(avatar.name),
  );

  // Skip if all avatars already exist
  if (avatarsToCreate.length === 0) {
    console.log('All system avatars already exist. Skipping seeding.');
    return;
  }

  console.log(
    `Seeding ${avatarsToCreate.length} new system avatars...`,
  );

  // Create only new avatars
  for (const avatarData of avatarsToCreate) {
    await prisma.avatar.create({
      data: {
        name: avatarData.name,
        url: avatarData.url,
        isSystemAvatar: true,
        isDeleted: false,        // Explicitly set to false
        deletedAt: null,         // Explicitly set to null
      },
    });

    console.log(`Created system avatar: ${avatarData.name}`);
  }

  console.log('System avatar seeding completed!');
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
