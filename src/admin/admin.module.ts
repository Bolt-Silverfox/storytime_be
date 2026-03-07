import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { CouponModule } from '../coupon/coupon.module';
import { AdminSseController } from './sse/admin-sse.controller';
import { AdminSseService } from './sse/admin-sse.service';
import { SseAuthGuard } from './sse/sse-auth.guard';

@Module({
  imports: [PrismaModule, AuthModule, VoiceModule, CouponModule],
  controllers: [AdminController, AdminSseController],
  providers: [AdminService, AdminSseService, SseAuthGuard],
  exports: [AdminService, AdminSseService],
})
export class AdminModule {}
