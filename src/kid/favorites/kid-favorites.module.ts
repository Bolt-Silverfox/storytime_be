import { Module } from '@nestjs/common';
import { KidFavoritesController } from './kid-favorites.controller';
import { KidFavoritesService } from './kid-favorites.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule, 
  ],
  controllers: [KidFavoritesController],
  providers: [KidFavoritesService],
  exports: [KidFavoritesService],
})
export class KidFavoritesModule {}
