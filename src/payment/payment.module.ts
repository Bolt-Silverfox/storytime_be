import { Module, forwardRef } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { AuthModule } from '../auth/auth.module';
import { GooglePlayVerifier } from './strategies/google-play.verifier';
import { AppStoreVerifier } from './strategies/app-store.verifier';
import { IapVerifierFactory } from './strategies/iap-verifier.factory';

@Module({
  imports: [
    forwardRef(() => AuthModule),
  ],
  providers: [
    PaymentService,
    GooglePlayVerifier,
    AppStoreVerifier,
    IapVerifierFactory,
  ],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule { }
