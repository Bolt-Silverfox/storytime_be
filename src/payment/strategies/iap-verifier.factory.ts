import { Injectable, BadRequestException } from '@nestjs/common';
import { IapPlatform } from '../dto/verify-purchase.dto';
import { IapVerifier } from './iap-verifier.interface';
import { GooglePlayVerifier } from './google-play.verifier';
import { AppStoreVerifier } from './app-store.verifier';

@Injectable()
export class IapVerifierFactory {
    constructor(
        private readonly googlePlayVerifier: GooglePlayVerifier,
        private readonly appStoreVerifier: AppStoreVerifier,
    ) { }

    getVerifier(platform: IapPlatform): IapVerifier {
        switch (platform) {
            case IapPlatform.ANDROID:
                return this.googlePlayVerifier;
            case IapPlatform.IOS:
                return this.appStoreVerifier;
            default:
                throw new BadRequestException(`Unsupported platform: ${platform}`);
        }
    }
}
