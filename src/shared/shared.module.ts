import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthSessionGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { CircuitBreakerService } from './services/circuit-breaker.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: 3600 },
      }),
    }),
  ],
  providers: [AuthSessionGuard, AdminGuard, CircuitBreakerService],
  exports: [AuthSessionGuard, AdminGuard, JwtModule, CircuitBreakerService],
})
export class SharedModule {}
