import { Module } from '@nestjs/common';
import { ParentFavoritesController } from './parent-favorites.controller';
import { ParentFavoritesService } from './parent-favorites.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ParentFavoritesController],
  providers: [ParentFavoritesService],
  exports: [ParentFavoritesService],
})
export class ParentFavoriteModule {}
