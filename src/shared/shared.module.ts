import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthSessionGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';

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
  providers: [AuthSessionGuard, AdminGuard],
  exports: [AuthSessionGuard, AdminGuard, JwtModule],
})
export class SharedModule {}
