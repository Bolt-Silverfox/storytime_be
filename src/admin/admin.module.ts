import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { CouponModule } from '../coupon/coupon.module';

@Module({
  imports: [PrismaModule, AuthModule, VoiceModule, CouponModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
