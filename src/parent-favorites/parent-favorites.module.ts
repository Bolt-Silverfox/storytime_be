import { Module } from '@nestjs/common';
import { ParentFavoritesController } from './parent-favorites.controller';
import { ParentFavoritesService } from './parent-favorites.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ParentFavoritesController],
  providers: [ParentFavoritesService, PrismaService],
  exports: [ParentFavoritesService],
})
export class ParentFavoriteModule {}
