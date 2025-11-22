import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgeGroupSeederService implements OnModuleInit {
  private readonly logger = new Logger(AgeGroupSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedAgeGroups();
  }

  private async seedAgeGroups() {
    const defaultAgeGroups = [
      { name: 'Early Toddler', min: 2, max: 3 },
      { name: 'Toddler', min: 4, max: 5 },
      { name: 'Early Reader', min: 6, max: 7 },
      { name: 'Young Explorer', min: 8, max: 9 },
      { name: 'Preteen', min: 10, max: 12 },
    ];

    try {
      this.logger.log('Seeding age groups...');

      for (const group of defaultAgeGroups) {
        await this.prisma.ageGroup.upsert({
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

        this.logger.log(`Upserted age group: ${group.name}`);
      }

      this.logger.log('Age group seeding completed!');
    } catch (error) {
      this.logger.error('Error seeding age groups:', error);
    }
  }
}
