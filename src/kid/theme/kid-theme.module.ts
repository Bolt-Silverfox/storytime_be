import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { KidThemeService } from './kid-theme.service';
import { KidThemeController } from './kid-theme.controller';
import { AuthModule } from '@/auth/auth.module';                  

@Module({
  imports: [
    PrismaModule,
    AuthModule,                
  ],
  controllers: [KidThemeController],
  providers: [KidThemeService],
  exports: [KidThemeService],
})
export class KidThemeModule {}
