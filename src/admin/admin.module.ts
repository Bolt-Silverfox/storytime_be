import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminUserAdminController } from './admin-user-admin.controller';
import { AdminStoryAdminController } from './admin-story-admin.controller';
import { AdminSupportController } from './admin-support.controller';
import { AdminCouponController } from './admin-coupon.controller';
import { AdminSystemController } from './admin-system.controller';
import { AdminService } from './admin.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminUserService } from './admin-user.service';
import { AdminCouponService } from './admin-coupon.service';
import { AdminExportService } from './admin-export.service';
import { AdminSubscriptionOpsService } from './admin-subscription-ops.service';
import { AdminStoryService } from './admin-story.service';
import { AdminSystemService } from './admin-system.service';
import {
  ADMIN_STORY_REPOSITORY,
  PrismaAdminStoryRepository,
  ADMIN_SYSTEM_REPOSITORY,
  PrismaAdminSystemRepository,
  ADMIN_USER_REPOSITORY,
  PrismaAdminUserRepository,
  ADMIN_SUBSCRIPTION_REPOSITORY,
  PrismaAdminSubscriptionRepository,
  ADMIN_PAYMENT_REPOSITORY,
  PrismaAdminPaymentRepository,
  ADMIN_COUPON_REPOSITORY,
  PrismaAdminCouponRepository,
  ADMIN_CONTENT_REPOSITORY,
  PrismaAdminContentRepository,
  ADMIN_ENGAGEMENT_REPOSITORY,
  PrismaAdminEngagementRepository,
  ADMIN_ACTIVITY_REPOSITORY,
  PrismaAdminActivityRepository,
  ADMIN_ANALYTICS_REPOSITORY,
  PrismaAdminAnalyticsRepository,
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
  controllers: [
    AdminDashboardController,
    AdminUserAdminController,
    AdminStoryAdminController,
    AdminSupportController,
    AdminCouponController,
    AdminSystemController,
    AdminSseController,
  ],
  providers: [
    AdminService,
    AdminAnalyticsService,
    AdminUserService,
    AdminCouponService,
    AdminExportService,
    AdminSubscriptionOpsService,
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
    {
      provide: ADMIN_USER_REPOSITORY,
      useClass: PrismaAdminUserRepository,
    },
    {
      provide: ADMIN_SUBSCRIPTION_REPOSITORY,
      useClass: PrismaAdminSubscriptionRepository,
    },
    {
      provide: ADMIN_PAYMENT_REPOSITORY,
      useClass: PrismaAdminPaymentRepository,
    },
    {
      provide: ADMIN_COUPON_REPOSITORY,
      useClass: PrismaAdminCouponRepository,
    },
    {
      provide: ADMIN_CONTENT_REPOSITORY,
      useClass: PrismaAdminContentRepository,
    },
    {
      provide: ADMIN_ENGAGEMENT_REPOSITORY,
      useClass: PrismaAdminEngagementRepository,
    },
    {
      provide: ADMIN_ACTIVITY_REPOSITORY,
      useClass: PrismaAdminActivityRepository,
    },
    {
      provide: ADMIN_ANALYTICS_REPOSITORY,
      useClass: PrismaAdminAnalyticsRepository,
    },
    AdminSseService,
    SseAuthGuard,
  ],
  exports: [AdminService, AdminSseService],
})
export class AdminModule {}
