import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminStoryService } from './admin-story.service';
import { AdminSystemService } from './admin-system.service';
import {
  ADMIN_STORY_REPOSITORY,
  PrismaAdminStoryRepository,
  ADMIN_SYSTEM_REPOSITORY,
  PrismaAdminSystemRepository,
} from './repositories';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { CouponModule } from '../coupon/coupon.module';
import { PaymentModule } from '../payment/payment.module';
import { AdminSseController } from './sse/admin-sse.controller';
import { AdminSseService } from './sse/admin-sse.service';
import { SseAuthGuard } from './sse/sse-auth.guard';

@Module({
  imports: [PrismaModule, AuthModule, VoiceModule, CouponModule, PaymentModule],
  controllers: [AdminController, AdminSseController],
  providers: [
    AdminService,
    AdminStoryService,
    AdminSystemService,
    {
      provide: ADMIN_STORY_REPOSITORY,
      useClass: PrismaAdminStoryRepository,
    },
    {
      provide: ADMIN_SYSTEM_REPOSITORY,
      useClass: PrismaAdminSystemRepository,
    },
    AdminSseService,
    SseAuthGuard,
  ],
  exports: [AdminService, AdminSseService],
})
export class AdminModule {}
