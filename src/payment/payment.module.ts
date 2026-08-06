import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { WebhookController } from './webhook.controller';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';
import { SubscriptionWebhookService } from './subscription-webhook.service';
import { GooglePubSubVerifierService } from './google-pubsub-verifier.service';

@Module({
  imports: [PrismaModule, ConfigModule, forwardRef(() => AuthModule)],
  providers: [
    PaymentService,
    GoogleVerificationService,
    AppleVerificationService,
    SubscriptionWebhookService,
    GooglePubSubVerifierService,
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
