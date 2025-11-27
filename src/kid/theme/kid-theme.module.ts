import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { KidThemeService } from './kid-theme.service';
import { KidThemeController } from './kid-theme.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KidThemeController],
  providers: [KidThemeService],
})
export class KidThemeModule {}

