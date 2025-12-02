import { Module } from '@nestjs/common';
import { AgeService } from './age.service';
import { AgeController } from './age.controller';
import { AgeGroupSeederService } from './age.seeders';

@Module({
  controllers: [AgeController],
  providers: [AgeService, AgeGroupSeederService],
  exports: [AgeService],
})
export class AgeModule {}
