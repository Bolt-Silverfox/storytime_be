import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminUserQueryController } from './admin-user-query.controller';
import { AdminUserModerationController } from './admin-user-moderation.controller';
import { AdminUserBillingController } from './admin-user-billing.controller';
import { AdminStoryAdminController } from './admin-story-admin.controller';
import { AdminSupportController } from './admin-support.controller';
import { AdminReadingAnalyticsController } from './admin-reading-analytics.controller';
import { AdminCouponController } from './admin-coupon.controller';
import { AdminFxRateController } from './admin-fx-rate.controller';
import { AdminFxRateService } from './admin-fx-rate.service';
import { AdminSystemController } from './admin-system.controller';
import { AdminAuditLogController } from './admin-audit-log.controller';
import { AdminUserHistoryController } from './admin-user-history.controller';
import { AdminService } from './admin.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminDashboardMetricsService } from './admin-dashboard-metrics.service';
import { AdminRevenueAnalyticsService } from './admin-revenue-analytics.service';
import { AdminSystemMetricsService } from './admin-system-metrics.service';
import { AdminGuestAnalyticsService } from './admin-guest-analytics.service';
import { AdminReadingAnalyticsService } from './admin-reading-analytics.service';
import { AdminUserService } from './admin-user.service';
import { AdminCouponService } from './admin-coupon.service';
import { AdminExportService } from './admin-export.service';
import { AdminSubscriptionOpsService } from './admin-subscription-ops.service';
import { AdminStoryService } from './admin-story.service';
import { AdminSystemService } from './admin-system.service';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminUserHistoryService } from './admin-user-history.service';
import { AdminContentImageService } from './admin-content-image.service';
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
  ADMIN_AUDIT_LOG_REPOSITORY,
  PrismaAdminAuditLogRepository,
  ADMIN_FX_RATE_REPOSITORY,
  PrismaAdminFxRateRepository,
  ADMIN_USER_HISTORY_REPOSITORY,
  PrismaAdminUserHistoryRepository,
} from './repositories';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { CouponModule } from '../coupon/coupon.module';
import { PaymentModule } from '../payment/payment.module';
import { HttpModule } from '@nestjs/axios';
import { UploadModule } from '../upload/upload.module';
import { AdminSseController } from './sse/admin-sse.controller';
import { AdminSseService } from './sse/admin-sse.service';
import { SseAuthGuard } from './sse/sse-auth.guard';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    VoiceModule,
    CouponModule,
    PaymentModule,
    HttpModule,
    UploadModule,
  ],
  controllers: [
    AdminDashboardController,
    AdminUserQueryController,
    AdminUserModerationController,
    AdminUserBillingController,
    AdminStoryAdminController,
    AdminSupportController,
    AdminReadingAnalyticsController,
    AdminCouponController,
    AdminFxRateController,
    AdminSystemController,
    AdminAuditLogController,
    AdminUserHistoryController,
    AdminSseController,
  ],
  providers: [
    AdminService,
    AdminAnalyticsService,
    AdminDashboardMetricsService,
    AdminRevenueAnalyticsService,
    AdminSystemMetricsService,
    AdminGuestAnalyticsService,
    AdminReadingAnalyticsService,
    AdminUserService,
    AdminCouponService,
    AdminExportService,
    AdminSubscriptionOpsService,
    AdminStoryService,
    AdminSystemService,
    AdminAuditLogService,
    AdminFxRateService,
    AdminUserHistoryService,
    AdminContentImageService,
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
    {
      provide: ADMIN_FX_RATE_REPOSITORY,
      useClass: PrismaAdminFxRateRepository,
    },
    {
      provide: ADMIN_AUDIT_LOG_REPOSITORY,
      useClass: PrismaAdminAuditLogRepository,
    },
    {
      provide: ADMIN_USER_HISTORY_REPOSITORY,
      useClass: PrismaAdminUserHistoryRepository,
    },
    AdminSseService,
    SseAuthGuard,
  ],
  exports: [AdminService, AdminSseService],
})
export class AdminModule {}
