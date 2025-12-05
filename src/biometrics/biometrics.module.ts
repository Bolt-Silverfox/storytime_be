import { Module } from '@nestjs/common';
import { BiometricsService } from './biometrics.service';
import { BiometricsController } from './biometrics.controller';

@Module({
  controllers: [BiometricsController],
  providers: [BiometricsService],
  exports: [BiometricsService],
})
export class BiometricsModule {}
