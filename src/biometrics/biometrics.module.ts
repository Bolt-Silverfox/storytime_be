import { Module } from '@nestjs/common';
import { BiometricsService } from './biometrics.service';
import { BiometricsController } from './biometrics.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BiometricsController],
  providers: [BiometricsService],
  exports: [BiometricsService],
})
export class BiometricsModule { }
