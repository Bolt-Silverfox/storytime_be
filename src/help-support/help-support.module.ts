import { Module } from '@nestjs/common';
import { HelpSupportController } from './help-support.controller';
import { HelpSupportService } from './help-support.service';
import { NotificationModule } from '@/notification/notification.module';
import {
  SUPPORT_TICKET_REPOSITORY,
  PrismaSupportTicketRepository,
} from './repositories';

@Module({
  imports: [NotificationModule],
  controllers: [HelpSupportController],
  providers: [
    HelpSupportService,
    // Repository Pattern (testability, decoupling)
    {
      provide: SUPPORT_TICKET_REPOSITORY,
      useClass: PrismaSupportTicketRepository,
    },
  ],
})
export class HelpSupportModule {}
