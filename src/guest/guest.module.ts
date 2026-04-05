import { Module, forwardRef } from '@nestjs/common';
import { GuestSessionService } from './guest-session.service';
import { GuestController } from './guest.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { StoryModule } from '@/story/story.module';
import { AnalyticsModule } from '@/analytics/analytics.module';

@Module({
  imports: [PrismaModule, forwardRef(() => StoryModule), AnalyticsModule],
  controllers: [GuestController],
  providers: [GuestSessionService],
  exports: [GuestSessionService],
})
export class GuestModule {}
