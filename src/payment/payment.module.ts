import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { WebhookController } from './webhook.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { SubscriptionModule } from '@/subscription/subscription.module';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { SubscriptionWebhookService } from './subscription-webhook.service';
import { GooglePubSubVerifierService } from './google-pubsub-verifier.service';
import {
  SUBSCRIPTION_REPOSITORY,
  PrismaSubscriptionRepository,
  PAYMENT_TRANSACTION_REPOSITORY,
  PrismaPaymentTransactionRepository,
} from './repositories';

@Module({
  imports: [PrismaModule, ConfigModule, SubscriptionModule],
  providers: [
    PaymentService,
    GoogleVerificationService,
    AppleVerificationService,
    SubscriptionWebhookService,
    GooglePubSubVerifierService,
    // Repository Pattern (testability, decoupling)
    {
      provide: SUBSCRIPTION_REPOSITORY,
      useClass: PrismaSubscriptionRepository,
    },
    {
      provide: PAYMENT_TRANSACTION_REPOSITORY,
      useClass: PrismaPaymentTransactionRepository,
    },
  ],
  controllers: [PaymentController, WebhookController],
  exports: [
    PaymentService,
    GoogleVerificationService,
    AppleVerificationService,
    SubscriptionWebhookService,
  ],
})
export class PaymentModule {}
