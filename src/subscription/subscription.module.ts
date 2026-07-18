import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import {
  SUBSCRIPTION_REPOSITORY,
  PrismaSubscriptionRepository,
  PAYMENT_TRANSACTION_REPOSITORY,
  PrismaPaymentTransactionRepository,
  USER_REPOSITORY,
  PrismaUserRepository,
} from './repositories';

@Module({
  imports: [PrismaModule],
  providers: [
    SubscriptionService,
    // Repository Pattern (testability, decoupling)
    {
      provide: SUBSCRIPTION_REPOSITORY,
      useClass: PrismaSubscriptionRepository,
    },
    {
      provide: PAYMENT_TRANSACTION_REPOSITORY,
      useClass: PrismaPaymentTransactionRepository,
    },
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
  ],
  controllers: [SubscriptionController],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
