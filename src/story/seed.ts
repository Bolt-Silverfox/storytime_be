import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.story.createMany({
    data: [
      {
        title: 'The Brave Little Fox',
        description: 'A story about a fox who learns to be brave.',
        language: 'English',
        theme: 'Adventure',
        category: 'Animals',
        coverImageUrl: 'https://example.com/cover1.jpg',
        audioUrl: 'https://example.com/audio1.mp3',
        isInteractive: false,
        ageMin: 4,
        ageMax: 8,
      },
      {
        title: 'The Magic Garden',
        description: 'A magical garden full of surprises.',
        language: 'English',
        theme: 'Fantasy',
        category: 'Nature',
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
        theme: 'Sci-Fi',
        category: 'Space',
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
        theme: 'Adventure',
        category: 'Ocean',
        coverImageUrl: 'https://example.com/cover4.jpg',
        audioUrl: 'https://example.com/audio4.mp3',
        isInteractive: true,
        ageMin: 6,
        ageMax: 11,
      },
      {
        title: 'The Robot Who Learned to Love',
        description: 'A robot discovers the meaning of friendship and love.',
        language: 'English',
        theme: 'Emotional',
        category: 'Robots',
        coverImageUrl: 'https://example.com/cover5.jpg',
        audioUrl: 'https://example.com/audio5.mp3',
        isInteractive: false,
        ageMin: 8,
        ageMax: 13,
      },
    ],
  });

  console.log('Seeded stories!');
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
