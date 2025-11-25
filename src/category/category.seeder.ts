import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgeGroup } from '@prisma/client';

@Injectable()
export class CategorySeederService implements OnModuleInit {
  private readonly logger = new Logger(CategorySeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedCategories();
  }

  private async seedCategories() {
    try {
      this.logger.log('Seeding categories...');

      // Get age groups
      const ageGroups = await this.prisma.ageGroup.findMany();

      if (ageGroups.length === 0) {
        this.logger.warn('No age groups found. Please seed age groups first.');
        return;
      }

      const toddler = ageGroups.find((ag) => ag.name === 'Age 1 - 4');
      const preschool = ageGroups.find((ag) => ag.name === 'Age 5 - 8');
      const kids = ageGroups.find((ag) => ag.name === 'Age 9 - 12');

      const defaultCategories = [
        {
          name: 'Baby Songs',
          slug: 'baby-songs',
          description: 'Gentle songs and lullabies for the youngest listeners',
          image: 'https://via.placeholder.com/400x300?text=Baby+Songs',
          ageGroupIds: toddler ? [toddler.id] : [],
        },
        {
          name: 'Animal Stories',
          slug: 'animal-stories',
          description: 'Fun stories featuring animals and their adventures',
          image: 'https://via.placeholder.com/400x300?text=Animal+Stories',
          ageGroupIds: [toddler, preschool].filter(Boolean).map((ag) => ag?.id),
        },
        {
          name: 'Fairy Tales',
          slug: 'fairy-tales',
          description: 'Classic fairy tales and magical stories',
          image: 'https://via.placeholder.com/400x300?text=Fairy+Tales',
          ageGroupIds: [preschool, kids].filter(Boolean).map((ag) => ag?.id),
        },
        {
          name: 'Adventure',
          slug: 'adventure',
          description: 'Exciting adventure stories for brave explorers',
          image: 'https://via.placeholder.com/400x300?text=Adventure',
          ageGroupIds: [preschool, kids].filter(Boolean).map((ag) => ag?.id),
        },
        {
          name: 'Science & Discovery',
          slug: 'science-discovery',
          description:
            'Educational stories about science and the world around us',
          image: 'https://via.placeholder.com/400x300?text=Science',
          ageGroupIds: kids ? [kids.id] : [],
        },
        {
          name: 'Mystery',
          slug: 'mystery',
          description: 'Intriguing mysteries and detective stories',
          image: 'https://via.placeholder.com/400x300?text=Mystery',
          ageGroupIds: kids ? [kids.id] : [],
        },
        {
          name: 'Bedtime Stories',
          slug: 'bedtime-stories',
          description: 'Calming stories perfect for bedtime',
          image: 'https://via.placeholder.com/400x300?text=Bedtime',
          ageGroupIds: [toddler, preschool, kids]
            .filter(Boolean)
            .map((ag) => ag?.id),
        },
      ];

      for (const category of defaultCategories) {
        const existing = await this.prisma.category.findUnique({
          where: { slug: category.slug },
        });

        if (!existing) {
          await this.prisma.category.create({
            data: {
              name: category.name,
              slug: category.slug,
              description: category.description,
              image: category.image,
              ageGroups: {
                create: category.ageGroupIds.map((ageGroupId) => ({
                  ageGroup: {
                    connect: { id: ageGroupId },
                  },
                })),
              },
            },
          });
          this.logger.log(`Created category: ${category.name}`);
        } else {
          this.logger.log(`Category already exists: ${category.name}`);
        }
      }

      this.logger.log('Category seeding completed!');
    } catch (error) {
      this.logger.error('Error seeding categories:', error);
    }
  }
}
