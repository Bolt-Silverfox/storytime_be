import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { SubscriptionModule } from '@/subscription/subscription.module';
import { GoogleVerificationService } from './google-verification.service';
import { AppleVerificationService } from './apple-verification.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    SubscriptionModule,
  ],
  providers: [
    PaymentService,
    GoogleVerificationService,
    AppleVerificationService,
  ],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule {}
