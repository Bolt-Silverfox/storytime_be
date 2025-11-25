import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { VOICEID } from './story.dto';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "stories", "_StoryCategories", "_StoryThemes", "Category", "Theme" RESTART IDENTITY CASCADE;',
  );

  const categories = [
    {
      name: 'Animal Stories',
      image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
      description: 'Stories featuring animals as main characters.',
    },
    {
      name: 'Adventure & Action',
      image: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca',
      description: 'Exciting stories full of adventure and action.',
    },
    {
      name: 'Bedtime Stories',
      image: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308',
      description: 'Gentle stories perfect for bedtime.',
    },
    {
      name: 'Cultural & Folklore Stories',
      image: 'https://images.unsplash.com/photo-1464983953574-0892a716854b',
      description: 'Stories from cultures and folklore around the world.',
    },
    {
      name: 'Drama & Family Stories',
      image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9',
      description: 'Stories about families and dramatic events.',
    },
    {
      name: 'Educational & Learning Stories',
      image: 'https://images.unsplash.com/photo-1465101178521-c1a9136a3b99',
      description: 'Stories that teach lessons or facts.',
    },
    {
      name: 'Fairy Tales',
      image: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9',
      description: 'Classic fairy tales with magical elements.',
    },
    {
      name: 'Fables & Morality Stories',
      image: 'https://images.unsplash.com/photo-1465101178521-c1a9136a3b99',
      description: 'Stories with morals and lessons.',
    },
    {
      name: 'Fantasy & Magic',
      image: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429',
      description: 'Stories set in magical or fantastical worlds.',
    },
    {
      name: 'Historical Fiction',
      image: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca',
      description: 'Stories set in historical times.',
    },
    {
      name: 'Holiday / Seasonal Stories',
      image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
      description: 'Stories about holidays and seasons.',
    },
    {
      name: 'Horror & Ghost Stories',
      image: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9',
      description: 'Spooky and scary stories.',
    },
    {
      name: 'Humor & Satire',
      image: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308',
      description: 'Funny and satirical stories.',
    },
    {
      name: 'Myths & Legends',
      image: 'https://images.unsplash.com/photo-1464983953574-0892a716854b',
      description: 'Mythical and legendary tales.',
    },
    {
      name: 'Nature',
      image: 'https://images.unsplash.com/photo-1465101178521-c1a9136a3b99',
      description: 'Stories about the natural world.',
    },
    {
      name: 'Ocean',
      image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
      description: 'Stories set in or around the ocean.',
    },
    {
      name: 'Mystery & Detective Stories',
      image: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca',
      description: 'Stories involving mysteries and detectives.',
    },
    {
      name: 'Robots',
      image: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97',
      description: 'Stories featuring robots and technology.',
    },
    {
      name: 'Romance & Love Stories',
      image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9',
      description: 'Stories about love and romance.',
    },
    {
      name: 'Science Fiction & Space',
      image: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564',
      description: 'Stories set in space or with science fiction themes.',
    },
  ];

  const themes = [
    {
      name: 'Adventure',
      image: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca',
      description: 'Themes of adventure and exploration.',
    },
    {
      name: 'Betrayal & Redemption',
      image: 'https://images.unsplash.com/photo-1464983953574-0892a716854b',
      description: 'Themes of betrayal and redemption.',
    },
    {
      name: 'Change & Transformation',
      image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
      description: 'Themes of change and transformation.',
    },
    {
      name: 'Coming of Age',
      image: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308',
      description: 'Themes of growing up and maturing.',
    },
    {
      name: 'Courage / Bravery',
      image: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9',
      description: 'Themes of courage and bravery.',
    },
    {
      name: 'Emotional',
      image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9',
      description: 'Themes of emotion and feeling.',
    },
    {
      name: 'Fantasy',
      image: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429',
      description: 'Themes of fantasy and magic.',
    },
    {
      name: 'Freedom & Adventure',
      image: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca',
      description: 'Themes of freedom and adventure.',
    },
    {
      name: 'Friendship & Belonging',
      image: 'https://images.unsplash.com/photo-1464983953574-0892a716854b',
      description: 'Themes of friendship and belonging.',
    },
    {
      name: 'Good vs. Evil',
      image: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9',
      description: 'Themes of good versus evil.',
    },
    {
      name: 'Greed vs. Generosity',
      image: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308',
      description: 'Themes of greed and generosity.',
    },
    {
      name: 'Healing & Forgiveness',
      image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9',
      description: 'Themes of healing and forgiveness.',
    },
    {
      name: 'Hope & Perseverance',
      image: 'https://images.unsplash.com/photo-1465101178521-c1a9136a3b99',
      description: 'Themes of hope and perseverance.',
    },
    {
      name: 'Honesty & Integrity',
      image: 'https://images.unsplash.com/photo-1465101178521-c1a9136a3b99',
      description: 'Themes of honesty and integrity.',
    },
    {
      name: 'Identity & Self-Discovery',
      image: 'https://images.unsplash.com/photo-1464983953574-0892a716854b',
      description: 'Themes of identity and self-discovery.',
    },
    {
      name: 'Justice & Fairness',
      image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
      description: 'Themes of justice and fairness.',
    },
    {
      name: 'Love & Family',
      image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9',
      description: 'Themes of love and family.',
    },
    {
      name: 'Sci-Fi',
      image: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564',
      description: 'Themes of science fiction.',
    },
    {
      name: 'Trust & Loyalty',
      image: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308',
      description: 'Themes of trust and loyalty.',
    },
  ];

  // Load stories from stories.json
  const storiesPath = path.resolve('src/story/stories.json');
  const stories = JSON.parse(fs.readFileSync(storiesPath, 'utf-8'));

  //temporary slug generation
  const categoriesWithSlug = categories.map((cat) => ({
    ...cat,
    slug: cat.name.toLowerCase().replace(/\s+/g, '-'),
  }));
  await prisma.category.createMany({ data: categoriesWithSlug });
  // await prisma.category.createMany({
  //   data: categories,
  //   skipDuplicates: true,
  // });

  await prisma.theme.createMany({
    data: themes,
    skipDuplicates: true,
  });

  // Before the loop, keep your master arrays:
  const categoriesArray = categories; // your master categories array
  const themesArray = themes; // your master themes array

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
            answer: question.answer,
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
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
