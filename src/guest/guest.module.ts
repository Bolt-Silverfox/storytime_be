import { Module, forwardRef } from '@nestjs/common';
import { GuestSessionService } from './guest-session.service';
import { GuestSessionController } from './guest-session.controller';
import { GuestStoryController } from './guest-story.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { StoryModule } from '@/story/story.module';
import { GuestActivityListener } from './listeners/guest-activity.listener';
import { GUEST_REPOSITORY } from './repositories/guest.repository.interface';
import { PrismaGuestRepository } from './repositories/prisma-guest.repository';

@Module({
  imports: [PrismaModule, forwardRef(() => StoryModule)],
  controllers: [GuestSessionController, GuestStoryController],
  providers: [
    GuestSessionService,
    GuestActivityListener,
    {
      provide: GUEST_REPOSITORY,
      useClass: PrismaGuestRepository,
    },
  ],
  exports: [GuestSessionService],
})
export class GuestModule {}
