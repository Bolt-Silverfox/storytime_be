import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthSessionGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { EventsModule } from './events';
import { CacheMetricsService } from './services/cache-metrics.service';
import { CircuitBreakerService } from './services/circuit-breaker.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    EventsModule,
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
    CacheMetricsService,
    CircuitBreakerService,
  ],
  exports: [
    AuthSessionGuard,
    AdminGuard,
    JwtModule,
    CacheMetricsService,
    CircuitBreakerService,
  ],
})
export class SharedModule {}
