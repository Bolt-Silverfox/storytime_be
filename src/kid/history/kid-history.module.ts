import { Module } from '@nestjs/common';
import { KidHistoryController } from './kid-history.controller';
import { KidHistoryService } from './kid-history.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [
    PrismaModule, 
    AuthModule,   
  ],
  controllers: [KidHistoryController],
  providers: [KidHistoryService],
  exports: [KidHistoryService],
})
export class KidHistoryModule {}
