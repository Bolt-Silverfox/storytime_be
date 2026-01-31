import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { IapVerifier } from './iap-verifier.interface';
import { IapPlatform } from '../dto/verify-purchase.dto';

@Injectable()
export class AppStoreVerifier implements IapVerifier {
    private readonly logger = new Logger(AppStoreVerifier.name);
    private readonly PRODUCTION_URL = 'https://buy.itunes.apple.com/verifyReceipt';
    private readonly SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

    async verify(productId: string, receiptData: string): Promise<boolean> {
        try {
            const secret = process.env.APPLE_SHARED_SECRET;
            if (!secret) {
                this.logger.warn('APPLE_SHARED_SECRET not set');
                return false;
            }

            // Try production first
            let res = await axios.post(this.PRODUCTION_URL, {
                'receipt-data': receiptData,
                password: secret,
                'exclude-old-transactions': true,
            });

            // If status is 21007, retry with sandbox
            if (res.data.status === 21007) {
                this.logger.log('Receipt is from sandbox. Retrying...');
                res = await axios.post(this.SANDBOX_URL, {
                    'receipt-data': receiptData,
                    password: secret,
                    'exclude-old-transactions': true,
                });
            }

            if (res.data.status === 0) {
                return true;
            }

            this.logger.warn(`Apple verification returned status: ${res.data.status}`);
            return false;
        } catch (error) {
            this.logger.error('Apple IAP Verification failed', error);
            return false;
        }
    }

    getPlatform(): IapPlatform {
        return IapPlatform.IOS;
    }
}
