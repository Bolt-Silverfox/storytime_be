import { Module } from '@nestjs/common';
import { KidController } from './kid.controller';
import { KidService } from './kid.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { VoiceModule } from '../voice/voice.module';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { AgeModule } from '../age/age.module';

@Module({
    imports: [
        AuthModule, 
        VoiceModule,
        AnalyticsModule,
        AgeModule
    ],
    controllers: [KidController],
    providers: [KidService, PrismaService],
    exports: [KidService],
})
export class KidModule { }