import { Module } from '@nestjs/common';
import { KidAchievementsController } from './kid-achievements.controller';
import { KidAchievementsService } from './kid-achievements.service';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [KidAchievementsController],
  providers: [KidAchievementsService],
  exports: [KidAchievementsService],
})
export class KidAchievementsModule {}
