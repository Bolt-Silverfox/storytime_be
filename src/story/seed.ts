import { PrismaClient } from '@prisma/client';

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

  const stories = [
    {
      title: 'The Midnight Rescue',
      description:
        'When a kitten is trapped in a tree, a group of animal friends bands together for a daring midnight rescue.',
      language: 'English',
      coverImageUrl:
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
      audioUrl: 'https://cdn.pixabay.com/audio/2022/10/16/audio_12b5b6b6c7.mp3',
      isInteractive: false,
      ageMin: 4,
      ageMax: 8,
      categories: ['Animal Stories', 'Adventure & Action', 'Bedtime Stories'],
      themes: ['Courage / Bravery', 'Friendship & Belonging', 'Good vs. Evil'],
    },
    {
      title: 'The Lantern Festival',
      description:
        'Mei and her grandmother share stories of their ancestors during the magical Lantern Festival in their village.',
      language: 'English',
      coverImageUrl:
        'https://images.unsplash.com/photo-1464983953574-0892a716854b',
      audioUrl: 'https://cdn.pixabay.com/audio/2022/10/16/audio_12b5b6b6c8.mp3',
      isInteractive: false,
      ageMin: 6,
      ageMax: 12,
      categories: [
        'Cultural & Folklore Stories',
        'Holiday / Seasonal Stories',
        'Drama & Family Stories',
      ],
      themes: [
        'Love & Family',
        'Hope & Perseverance',
        'Identity & Self-Discovery',
      ],
    },
    {
      title: 'The Secret of the Old Library',
      description:
        "Three friends discover a hidden room in their town's library, leading to a mystery only they can solve.",
      language: 'English',
      coverImageUrl:
        'https://images.unsplash.com/photo-1465101178521-c1a9136a3b99',
      audioUrl: 'https://cdn.pixabay.com/audio/2022/10/16/audio_12b5b6b6c9.mp3',
      isInteractive: true,
      ageMin: 7,
      ageMax: 13,
      categories: [
        'Mystery & Detective Stories',
        'Educational & Learning Stories',
        'Historical Fiction',
      ],
      themes: [
        'Change & Transformation',
        'Honesty & Integrity',
        'Friendship & Belonging',
      ],
    },
    {
      title: "The Ocean's Promise",
      description:
        'A young dolphin must journey across the ocean to save her pod, learning about courage and trust along the way.',
      language: 'English',
      coverImageUrl:
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
      audioUrl: 'https://cdn.pixabay.com/audio/2022/10/16/audio_12b5b6b6d0.mp3',
      isInteractive: false,
      ageMin: 5,
      ageMax: 10,
      categories: ['Ocean', 'Animal Stories', 'Adventure & Action'],
      themes: ['Courage / Bravery', 'Trust & Loyalty', 'Hope & Perseverance'],
    },
    {
      title: "The Robot's First Dream",
      description:
        'In a futuristic city, a robot discovers what it means to dream, and to care for others.',
      language: 'English',
      coverImageUrl:
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97',
      audioUrl: 'https://cdn.pixabay.com/audio/2022/10/16/audio_12b5b6b6d1.mp3',
      isInteractive: true,
      ageMin: 8,
      ageMax: 14,
      categories: ['Robots', 'Science Fiction & Space', 'Fantasy & Magic'],
      themes: [
        'Emotional',
        'Identity & Self-Discovery',
        'Healing & Forgiveness',
      ],
    },
  ];

  await prisma.category.createMany({
    data: categories,
    skipDuplicates: true,
  });

  await prisma.theme.createMany({
    data: themes,
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
