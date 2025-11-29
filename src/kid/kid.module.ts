import { Module } from '@nestjs/common';
import { KidController } from './kid.controller';
import { KidService } from './kid.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { KidDownloadsModule } from './downloads/kid-downloads.module';
import { KidThemeModule } from './theme/kid-theme.module';
import { KidHistoryModule } from './history/kid-history.module';
import { KidFavoritesModule } from './favorites/kid-favorites.module';
import { KidAchievementsModule } from './achievements/kid-achievements.module';
import { AvatarModule } from '@/avatar/avatar.module';


@Module({
    imports: [
      AuthModule, 
      VoiceModule,
      KidDownloadsModule,
      KidThemeModule, 
      KidFavoritesModule,
      KidAchievementsModule,
      KidHistoryModule,
      VoiceModule,
      AvatarModule,

    ],
    controllers: [KidController],
    providers: [KidService, PrismaService],
    exports: [KidService],
})
export class KidModule {}
