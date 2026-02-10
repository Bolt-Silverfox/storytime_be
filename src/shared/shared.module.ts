import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthSessionGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { PrismaModule } from '@/prisma/prisma.module';
import { AnalyticsEventListener } from './listeners/analytics-event.listener';
import { ActivityLogEventListener } from './listeners/activity-log-event.listener';

@Global()
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: 3600 },
      }),
    }),
  ],
  providers: [
    AuthSessionGuard,
    AdminGuard,
    AnalyticsEventListener,
    ActivityLogEventListener,
  ],
  exports: [AuthSessionGuard, AdminGuard, JwtModule],
})
export class SharedModule {}
