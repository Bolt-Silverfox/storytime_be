import { Module, forwardRef } from '@nestjs/common';
import { GuestSessionService } from './guest-session.service';
import { GuestController } from './guest.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { StoryModule } from '@/story/story.module';
import { GuestActivityListener } from './listeners/guest-activity.listener';

@Module({
  imports: [PrismaModule, forwardRef(() => StoryModule)],
  controllers: [GuestController],
  providers: [GuestSessionService, GuestActivityListener],
  exports: [GuestSessionService],
})
export class GuestModule {}
