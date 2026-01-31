import { Module } from '@nestjs/common';
import { AgeService } from './age.service';
import { AgeController } from './age.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { AGE_REPOSITORY, PrismaAgeRepository } from './repositories';

@Module({
  imports: [PrismaModule],
  controllers: [AgeController],
  providers: [
    AgeService,
    {
      provide: AGE_REPOSITORY,
      useClass: PrismaAgeRepository,
    },
  ],
  exports: [AgeService],
})
export class AgeModule {}
