import { Module } from '@nestjs/common';
import { KidStreakController } from './kid-streak.controller';
import { KidStreakService } from './kid-streak.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [KidStreakController],
  providers: [KidStreakService],
  exports: [KidStreakService],
})
export class KidStreakModule {}
