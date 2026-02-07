import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as https from 'https';

/** Result from Apple verification */
export interface AppleVerificationResult {
  success: boolean;
  platformTxId?: string;
  originalTxId?: string;
  productId?: string;
  amount?: number | null;
  currency?: string | null;
  purchaseTime?: Date | null;
  expirationTime?: Date | null;
  isSubscription?: boolean;
  raw?: unknown;
  metadata?: Record<string, unknown>;
}

/** Parameters for verification */
export interface AppleVerifyParams {
  transactionId: string;
  productId: string;
}

/** Decoded transaction info from Apple */
interface AppleTransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  purchaseDate: number;
  expiresDate?: number;
  type: 'Auto-Renewable Subscription' | 'Non-Consumable' | 'Consumable' | 'Non-Renewing Subscription';
  inAppOwnershipType: 'PURCHASED' | 'FAMILY_SHARED';
  environment: 'Sandbox' | 'Production';
  price?: number;
  currency?: string;
  revocationDate?: number;
  revocationReason?: number;
}

/**
 * Service to verify Apple App Store purchases using App Store Server API v2.
 */
@Injectable()
export class AppleVerificationService {
  private readonly logger = new Logger(AppleVerificationService.name);
  private readonly keyId: string;
  private readonly issuerId: string;
  private readonly bundleId: string;
  private readonly privateKey: string;
  private readonly environment: 'sandbox' | 'production';

  constructor(private readonly configService: ConfigService) {
    this.keyId = this.configService.get<string>('APPLE_KEY_ID') || '';
    this.issuerId = this.configService.get<string>('APPLE_ISSUER_ID') || '';
    this.bundleId = this.configService.get<string>('APPLE_BUNDLE_ID') || '';
    this.privateKey = this.configService.get<string>('APPLE_PRIVATE_KEY') || '';

    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    this.environment = nodeEnv === 'production' ? 'production' : 'sandbox';
  }

  async verify(params: AppleVerifyParams): Promise<AppleVerificationResult> {
    const { transactionId, productId } = params;

    if (!transactionId) {
      throw new HttpException(
        'transactionId is required for Apple verification',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!this.keyId || !this.issuerId || !this.bundleId || !this.privateKey) {
      this.logger.error('Apple App Store credentials not configured');
      throw new HttpException(
        'Apple App Store verification not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(
      `Starting Apple verification for transaction ${this.sanitizeForLog(transactionId)}`,
    );

    try {
      const token = this.generateJWT();
      const transactionInfo = await this.getTransactionInfo(transactionId, token);

      if (!transactionInfo) {
        return { success: false };
      }

      // Check if revoked
      if (transactionInfo.revocationDate) {
        this.logger.warn(`Transaction ${transactionId} has been revoked`);
        return { success: false };
      }

      // Verify product ID matches - fail if mismatch
      if (transactionInfo.productId !== productId) {
        this.logger.error(
          `Product ID mismatch: expected ${this.sanitizeForLog(productId)}, got ${this.sanitizeForLog(transactionInfo.productId)}`,
        );
        throw new HttpException(
          `Product ID mismatch: transaction is for ${transactionInfo.productId}, not ${productId}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const isSubscription =
        transactionInfo.type === 'Auto-Renewable Subscription' ||
        transactionInfo.type === 'Non-Renewing Subscription';

      // Check expiration for subscriptions
      const now = Date.now();
      const expired =
        isSubscription &&
        transactionInfo.expiresDate &&
        transactionInfo.expiresDate < now;

      return {
        success: !expired,
        platformTxId: transactionInfo.transactionId,
        originalTxId: transactionInfo.originalTransactionId,
        productId: transactionInfo.productId,
        amount: transactionInfo.price ? transactionInfo.price / 1000 : null,
        currency: transactionInfo.currency ?? null,
        purchaseTime: new Date(transactionInfo.purchaseDate),
        expirationTime: transactionInfo.expiresDate
          ? new Date(transactionInfo.expiresDate)
          : null,
        isSubscription,
        raw: transactionInfo,
        metadata: {
          environment: transactionInfo.environment,
          ownershipType: transactionInfo.inAppOwnershipType,
          type: transactionInfo.type,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Apple verification failed: ${this.errorMessage(error)}`);
      throw new HttpException(
        'Failed to verify Apple App Store purchase',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private generateJWT(): string {
    const header = {
      alg: 'ES256',
      kid: this.keyId,
      typ: 'JWT',
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.issuerId,
      iat: now,
      exp: now + 3600, // 1 hour expiry
      aud: 'appstoreconnect-v1',
      bid: this.bundleId,
    };

    const headerB64 = this.base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${headerB64}.${payloadB64}`;

    // Format the private key if needed
    let formattedKey = this.privateKey;
    if (!formattedKey.includes('-----BEGIN')) {
      formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`;
    }
    // Handle escaped newlines from env var
    formattedKey = formattedKey.replace(/\\n/g, '\n');

    const sign = crypto.createSign('SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(formattedKey);

    // Convert DER signature to raw r||s format for ES256
    const rawSignature = this.derToRaw(signature);
    const signatureB64 = this.base64UrlEncode(rawSignature);

    return `${signatureInput}.${signatureB64}`;
  }

  private async getTransactionInfo(
    transactionId: string,
    token: string,
  ): Promise<AppleTransactionInfo | null> {
    const baseUrl =
      this.environment === 'production'
        ? 'api.storekit.itunes.apple.com'
        : 'api.storekit-sandbox.itunes.apple.com';

    const path = `/inApps/v1/transactions/${transactionId}`;

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: baseUrl,
          path,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(data);
                // The signedTransactionInfo is a JWS, decode the payload
                const decoded = this.decodeJWS(response.signedTransactionInfo);
                resolve(decoded as AppleTransactionInfo);
              } catch {
                reject(new Error('Failed to parse Apple response'));
              }
            } else if (res.statusCode === 404) {
              this.logger.warn(`Transaction ${transactionId} not found`);
              resolve(null);
            } else {
              this.logger.error(`Apple API error: ${res.statusCode} - ${data}`);
              reject(new Error(`Apple API returned ${res.statusCode}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(10000, () => { // 10 second timeout (reduced from 30s)
        req.destroy();
        reject(new Error('Apple API request timeout'));
      });
      req.end();
    });
  }

  private decodeJWS(jws: string): unknown {
    const parts = jws.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWS format');
    }
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  }

  private base64UrlEncode(input: string | Buffer): string {
    const buffer = typeof input === 'string' ? Buffer.from(input) : input;
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private derToRaw(derSignature: Buffer): Buffer {
    // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
    let offset = 2; // Skip 0x30 and length byte
    if (derSignature[1] & 0x80) {
      offset += (derSignature[1] & 0x7f);
    }

    // Read r
    offset++; // Skip 0x02
    let rLength = derSignature[offset++];
    if (rLength & 0x80) {
      const lenBytes = rLength & 0x7f;
      rLength = 0;
      for (let i = 0; i < lenBytes; i++) {
        rLength = (rLength << 8) | derSignature[offset++];
      }
    }
    let r = derSignature.subarray(offset, offset + rLength);
    offset += rLength;

    // Read s
    offset++; // Skip 0x02
    let sLength = derSignature[offset++];
    if (sLength & 0x80) {
      const lenBytes = sLength & 0x7f;
      sLength = 0;
      for (let i = 0; i < lenBytes; i++) {
        sLength = (sLength << 8) | derSignature[offset++];
      }
    }
    let s = derSignature.subarray(offset, offset + sLength);

    // Remove leading zeros and pad to 32 bytes each
    if (r.length > 32) r = r.subarray(r.length - 32);
    if (s.length > 32) s = s.subarray(s.length - 32);

    const raw = Buffer.alloc(64);
    r.copy(raw, 32 - r.length);
    s.copy(raw, 64 - s.length);

    return raw;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /** Sanitize value for safe logging (truncate, remove control characters) */
  private sanitizeForLog(value: string, maxLen = 32): string {
    // Remove control characters using Unicode property escape and limit length
    const sanitized = value.replace(/\p{Cc}/gu, '').substring(0, maxLen);
    return value.length > maxLen ? `${sanitized}...` : sanitized;
  }
}
