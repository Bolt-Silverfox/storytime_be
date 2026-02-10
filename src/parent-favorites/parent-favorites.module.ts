import { Module } from '@nestjs/common';
import { ParentFavoritesController } from './parent-favorites.controller';
import { ParentFavoritesService } from './parent-favorites.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  PARENT_FAVORITE_REPOSITORY,
  PrismaParentFavoriteRepository,
} from './repositories';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ParentFavoritesController],
  providers: [
    ParentFavoritesService,
    {
      provide: PARENT_FAVORITE_REPOSITORY,
      useClass: PrismaParentFavoriteRepository,
    },
  ],
  exports: [ParentFavoritesService],
})
export class ParentFavoriteModule {}
