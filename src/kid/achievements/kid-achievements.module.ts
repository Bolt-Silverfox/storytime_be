import { Module } from '@nestjs/common';
import { KidAchievementsController } from './kid-achievements.controller';
import { KidAchievementsService } from './kid-achievements.service';
import { PrismaModule } from '../../prisma/prisma.module'; 
import { AuthModule } from '@/auth/auth.module';   
          

@Module({
  imports: [
    PrismaModule,
    AuthModule,              
  ],
  controllers: [KidAchievementsController],
  providers: [KidAchievementsService],
  exports: [KidAchievementsService],
})
export class KidAchievementsModule {}
