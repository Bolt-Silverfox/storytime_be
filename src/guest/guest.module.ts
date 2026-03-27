import { Module } from '@nestjs/common';
import { GuestSessionService } from './guest-session.service';
import { GuestController } from './guest.controller';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GuestController],
  providers: [GuestSessionService],
  exports: [GuestSessionService],
})
export class GuestModule {}
