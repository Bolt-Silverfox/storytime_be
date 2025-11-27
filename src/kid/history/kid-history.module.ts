import { Module } from '@nestjs/common';
import { KidHistoryController } from './kid-history.controller';
import { KidHistoryService } from './kid-history.service';

@Module({
  controllers: [KidHistoryController],
  providers: [KidHistoryService],
  exports: [KidHistoryService],
})
export class KidHistoryModule {}
