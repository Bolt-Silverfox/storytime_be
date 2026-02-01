import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { IapVerifier } from './iap-verifier.interface';
import { IapPlatform } from '../dto/verify-purchase.dto';

@Injectable()
export class GooglePlayVerifier implements IapVerifier {
    private readonly logger = new Logger(GooglePlayVerifier.name);

    async verify(productId: string, token: string): Promise<boolean> {
        try {
            const auth = new google.auth.JWT({
                email: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL,
                key: process.env.GOOGLE_PLAY_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/androidpublisher'],
            });

            const androidPublisher = google.androidpublisher({
                version: 'v3',
                auth,
            });

            const packageName = process.env.GOOGLE_PACKAGE_NAME || 'com.storytime.app';

            const res = await androidPublisher.purchases.subscriptions.get({
                packageName,
                subscriptionId: productId,
                token,
            });

            if (res.data.paymentState === 1 || (res.data.expiryTimeMillis && parseInt(res.data.expiryTimeMillis) > Date.now())) {
                return true;
            }
            return false;
        } catch (error) {
            this.logger.error(`Google IAP Verification failed for product ${productId}`, error);
            return false;
        }
    }

    getPlatform(): IapPlatform {
        return IapPlatform.ANDROID;
    }
}
