import { Module } from '@nestjs/common';
import { KidController } from './kid.controller';
import { KidService } from './kid.service';
import { AuthModule } from '../auth/auth.module';
import { KidDownloadsModule } from './downloads/kid-downloads.module';
import { KidThemeModule } from './theme/kid-theme.module';

@Module({
  imports: [
    AuthModule,
    KidDownloadsModule,
    KidThemeModule,
  ],
  controllers: [KidController],
  providers: [KidService],
  exports: [KidService],
})
export class KidModule {}
