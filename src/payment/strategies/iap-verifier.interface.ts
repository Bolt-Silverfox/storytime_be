import { IapPlatform } from '../dto/verify-purchase.dto';

export interface IapVerifier {
    verify(productId: string, receipt: string): Promise<boolean>;
    getPlatform(): IapPlatform;
}
