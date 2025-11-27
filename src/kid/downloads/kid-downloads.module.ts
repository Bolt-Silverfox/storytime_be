import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { KidDownloadsService } from './kid-downloads.service';
import { KidDownloadsController } from './kid-downloads.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KidDownloadsController],
  providers: [KidDownloadsService],
})
export class KidDownloadsModule {}

