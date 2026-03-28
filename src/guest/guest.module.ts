import { Module, forwardRef } from '@nestjs/common';
import { GuestSessionService } from './guest-session.service';
import { GuestController } from './guest.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { StoryModule } from '@/story/story.module';

@Module({
  imports: [PrismaModule, forwardRef(() => StoryModule)],
  controllers: [GuestController],
  providers: [GuestSessionService],
  exports: [GuestSessionService],
})
export class GuestModule {}
