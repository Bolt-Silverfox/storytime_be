import { Module } from '@nestjs/common';
import { KidFavoritesController } from './kid-favorites.controller';
import { KidFavoritesService } from './kid-favorites.service';

@Module({
  controllers: [KidFavoritesController],
  providers: [KidFavoritesService],
  exports: [KidFavoritesService],
})
export class KidFavoritesModule {}
