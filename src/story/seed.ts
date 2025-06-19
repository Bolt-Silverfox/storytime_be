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
    ],
  });
  console.log('Seeded stories!');
}

main().finally(() => prisma.$disconnect()); 