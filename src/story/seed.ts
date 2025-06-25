import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const categories = [
    'Animal Stories',
    'Adventure & Action',
    'Bedtime Stories',
    'Cultural & Folklore Stories',
    'Drama & Family Stories',
    'Educational & Learning Stories',
    'Fairy Tales',
    'Fables & Morality Stories',
    'Fantasy & Magic',
    'Historical Fiction',
    'Holiday / Seasonal Stories',
    'Horror & Ghost Stories',
    'Humor & Satire',
    'Myths & Legends',
    'Nature',
    'Ocean',
    'Mystery & Detective Stories',
    'Robots',
    'Romance & Love Stories',
    'Science Fiction & Space',
  ];

  const themes = [
    'Adventure',
    'Betrayal & Redemption',
    'Change & Transformation',
    'Coming of Age',
    'Courage / Bravery',
    'Emotional',
    'Fantasy',
    'Freedom & Adventure',
    'Friendship & Belonging',
    'Good vs. Evil',
    'Greed vs. Generosity',
    'Healing & Forgiveness',
    'Hope & Perseverance',
    'Honesty & Integrity',
    'Identity & Self-Discovery',
    'Justice & Fairness',
    'Love & Family',
    'Sci-Fi',
    'Trust & Loyalty',
  ];

  const stories = [
    {
      title: 'The Brave Little Fox',
      description: 'A story about a fox who learns to be brave.',
      language: 'English',
      coverImageUrl: 'https://example.com/cover1.jpg',
      audioUrl: 'https://example.com/audio1.mp3',
      isInteractive: false,
      ageMin: 4,
      ageMax: 8,
      categories: [
        'Animal Stories',
        'Bedtime Stories',
        'Fables & Morality Stories',
      ],
      themes: [
        'Courage / Bravery',
        'Friendship & Belonging',
        'Trust & Loyalty',
      ],
    },
    {
      title: 'The Magic Garden',
      description: 'A magical garden full of surprises.',
      language: 'English',
      categories: [
        'Nature',
        'Fantasy & Magic',
        'Educational & Learning Stories',
      ],
      themes: ['Fantasy', 'Hope & Perseverance', 'Change & Transformation'],
      coverImageUrl: 'https://example.com/cover2.jpg',
      audioUrl: 'https://example.com/audio2.mp3',
      isInteractive: true,
      ageMin: 5,
      ageMax: 10,
    },
    {
      title: 'The Lost Spaceship',
      description:
        'A thrilling journey through space to find a missing spaceship.',
      language: 'English',
      categories: ['Science Fiction & Space', 'Adventure & Action'],
      themes: ['Sci-Fi', 'Freedom & Adventure', 'Identity & Self-Discovery'],
      coverImageUrl: 'https://example.com/cover3.jpg',
      audioUrl: 'https://example.com/audio3.mp3',
      isInteractive: false,
      ageMin: 7,
      ageMax: 12,
    },
    {
      title: 'The Underwater Kingdom',
      description:
        'Explore the mysteries of the ocean in this underwater adventure.',
      language: 'English',
      categories: ['Ocean', 'Adventure & Action', 'Myths & Legends'],
      themes: ['Adventure', 'Good vs. Evil', 'Change & Transformation'],
      coverImageUrl: 'https://example.com/cover4.jpg',
      audioUrl: 'https://example.com/audio4.mp3',
      isInteractive: true,
      ageMin: 6,
      ageMax: 11,
      recommended: true,
    },
    {
      title: 'The Robot Who Learned to Love',
      description: 'A robot discovers the meaning of friendship and love.',
      language: 'English',
      categories: [
        'Robots',
        'Science Fiction & Space',
        'Drama & Family Stories',
      ],
      themes: ['Emotional', 'Love & Family', 'Healing & Forgiveness'],
      coverImageUrl: 'https://example.com/cover5.jpg',
      audioUrl: 'https://example.com/audio5.mp3',
      isInteractive: false,
      ageMin: 8,
      ageMax: 13,
      recommended: true,
    },
  ];

  await prisma.category.createMany({
    data: categories.map((name) => ({ name })),
    skipDuplicates: true,
  });

  await prisma.theme.createMany({
    data: themes.map((name) => ({ name })),
    skipDuplicates: true,
  });

  for (const story of stories) {
    await prisma.story.create({
      data: {
        title: story.title,
        description: story.description,
        language: story.language,
        coverImageUrl: story.coverImageUrl,
        audioUrl: story.audioUrl,
        isInteractive: story.isInteractive,
        ageMin: story.ageMin,
        ageMax: story.ageMax,
        categories: { connect: story.categories.map((name) => ({ name })) },
        themes: { connect: story.themes.map((name) => ({ name })) },
      },
    });
  }

  console.log('Seeded stories!');
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
