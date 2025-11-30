import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { KidDownloadsService } from './kid-downloads.service';
import { KidDownloadsController } from './kid-downloads.controller';
import { AuthModule } from '@/auth/auth.module';   
            
@Module({
  imports: [
    PrismaModule,
    AuthModule,  

  ],
  controllers: [KidDownloadsController],
  providers: [KidDownloadsService],
})
export class KidDownloadsModule {}
