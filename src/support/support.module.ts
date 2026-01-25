import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { NotificationModule } from '../notification/notification.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [NotificationModule, ConfigModule],
    controllers: [SupportController],
    providers: [SupportService],
})
export class SupportModule { }