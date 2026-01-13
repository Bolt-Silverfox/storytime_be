import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { defaultAgeGroups } from '../../prisma/data';

@Injectable()
export class AgeGroupSeederService {
  private readonly logger = new Logger(AgeGroupSeederService.name);

  constructor(private readonly prisma: PrismaService) { }

  async seedAgeGroups() {


    try {
      this.logger.log('Seeding age groups...');

      // 1. Sync: Upsert new groups
      for (const group of defaultAgeGroups) {
        await this.prisma.ageGroup.upsert({
          where: { name: group.name },
          update: {
            min: group.min,
            max: group.max,
            isDeleted: false, // Ensure it's active
          },
          create: {
            name: group.name,
            min: group.min,
            max: group.max,
          },
        });
        this.logger.log(`Upserted age group: ${group.name}`);
      }

      // 2. Cleanup: Delete groups that are NOT in the new list
      const newNames = defaultAgeGroups.map((g) => g.name);
      await this.prisma.ageGroup.deleteMany({
        where: {
          name: { notIn: newNames },
        },
      });
      this.logger.log('Removed outdated age groups.');

      this.logger.log('Age group seeding completed!');
    } catch (error) {
      this.logger.error('Error seeding age groups:', error);
    }
  }
}
