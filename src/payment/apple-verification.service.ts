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

/** Result from Apple subscription status check */
export interface AppleSubscriptionStatus {
  autoRenewActive: boolean;
  expirationTime?: Date | null;
  error?: string;
}

/** Parameters for verification */
export interface AppleVerifyParams {
  transactionId: string;
  productId: string;
}

/** Decoded JWSTransaction payload from an ASSN v2 notification */
export interface AppleDecodedTransaction {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  type?: string;
  appAccountToken?: string;
  revocationDate?: number;
  revocationReason?: number;
  environment?: string;
  [key: string]: unknown;
}

/** Decoded JWSRenewalInfo payload from an ASSN v2 notification */
export interface AppleDecodedRenewal {
  originalTransactionId?: string;
  autoRenewStatus?: number;
  autoRenewProductId?: string;
  productId?: string;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  [key: string]: unknown;
}

/**
 * Decoded & signature-verified App Store Server Notification v2.
 * @see https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
 */
export interface AppleNotificationInfo {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  bundleId?: string;
  environment?: string;
  signedDate?: number;
  transactionInfo?: AppleDecodedTransaction;
  renewalInfo?: AppleDecodedRenewal;
  /** Full decoded outer payload, kept for auditing/debugging */
  raw: Record<string, unknown>;
}

/** Decoded transaction info from Apple */
interface AppleTransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  purchaseDate: number;
  expiresDate?: number;
  type:
    | 'Auto-Renewable Subscription'
    | 'Non-Consumable'
    | 'Consumable'
    | 'Non-Renewing Subscription';
  inAppOwnershipType: 'PURCHASED' | 'FAMILY_SHARED';
  environment: 'Sandbox' | 'Production';
  price?: number;
  currency?: string;
  revocationDate?: number;
  revocationReason?: number;
}

const PRODUCTION_HOST = 'api.storekit.itunes.apple.com';
const SANDBOX_HOST = 'api.storekit-sandbox.itunes.apple.com';

/**
 * SHA-256 fingerprint of "Apple Root CA - G3", the trust anchor for the x5c
 * certificate chain in ASSN v2 JWS headers. Overridable via
 * APPLE_ROOT_CA_FINGERPRINT. VERIFY THIS VALUE against the certificate at
 * https://www.apple.com/certificateauthority/ before going live.
 */
const APPLE_ROOT_CA_G3_FINGERPRINT =
  '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';

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
  private readonly rootCaFingerprint: string;

  constructor(private readonly configService: ConfigService) {
    this.keyId = this.configService.get<string>('APPLE_KEY_ID') || '';
    this.issuerId = this.configService.get<string>('APPLE_ISSUER_ID') || '';
    this.bundleId = this.configService.get<string>('APPLE_BUNDLE_ID') || '';
    this.privateKey = this.configService.get<string>('APPLE_PRIVATE_KEY') || '';
    this.rootCaFingerprint = (
      this.configService.get<string>('APPLE_ROOT_CA_FINGERPRINT') ||
      APPLE_ROOT_CA_G3_FINGERPRINT
    )
      .toUpperCase()
      .replace(/\s/g, '');

    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    this.environment = nodeEnv === 'production' ? 'production' : 'sandbox';
  }

  /**
   * Verify and decode an App Store Server Notification v2 signed payload.
   *
   * Cryptographically verifies the JWS signature against the x5c certificate
   * chain (anchored to Apple Root CA - G3), then decodes the outer payload and
   * the nested signedTransactionInfo / signedRenewalInfo JWS objects.
   *
   * @throws HttpException(400) when the signature/chain is invalid or the
   *         payload is malformed.
   */
  parseSignedNotification(signedPayload: string): AppleNotificationInfo {
    if (!signedPayload || typeof signedPayload !== 'string') {
      throw new HttpException(
        'Missing Apple signedPayload',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Verify the JWS signature + certificate chain before trusting anything.
    this.verifyJWS(signedPayload);

    // 2. Decode the outer notification payload.
    const outer = this.decodeJWS(signedPayload) as Record<string, unknown>;
    const notificationType = outer.notificationType as string | undefined;
    const notificationUUID = outer.notificationUUID as string | undefined;

    if (!notificationType || !notificationUUID) {
      throw new HttpException(
        'Invalid Apple notification payload: missing notificationType/notificationUUID',
        HttpStatus.BAD_REQUEST,
      );
    }

    const data = (outer.data ?? {}) as Record<string, unknown>;

    // Reject notifications addressed to a different app. A JWS can be validly
    // Apple-signed yet belong to another bundle; without this check any such
    // notification would be recorded and routed into subscription processing.
    const bundleId = data.bundleId as string | undefined;
    if (this.bundleId && bundleId && bundleId !== this.bundleId) {
      this.logger.warn(
        `Apple notification bundleId mismatch (got ${this.sanitizeForLog(bundleId)})`,
      );
      throw new HttpException(
        'Apple notification bundleId does not match configured app',
        HttpStatus.BAD_REQUEST,
      );
    }

    let transactionInfo: AppleDecodedTransaction | undefined;
    let renewalInfo: AppleDecodedRenewal | undefined;

    try {
      if (typeof data.signedTransactionInfo === 'string') {
        transactionInfo = this.decodeJWS(
          data.signedTransactionInfo,
        ) as AppleDecodedTransaction;
      }
      if (typeof data.signedRenewalInfo === 'string') {
        renewalInfo = this.decodeJWS(
          data.signedRenewalInfo,
        ) as AppleDecodedRenewal;
      }
    } catch {
      throw new HttpException(
        'Failed to decode Apple notification transaction data',
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      notificationType,
      subtype: outer.subtype as string | undefined,
      notificationUUID,
      bundleId: data.bundleId as string | undefined,
      environment: data.environment as string | undefined,
      signedDate: outer.signedDate as number | undefined,
      transactionInfo,
      renewalInfo,
      raw: outer,
    };
  }

  /**
   * Verify a JWS signature using the x5c certificate chain embedded in its
   * header. Confirms: (a) each certificate is signed by the next, (b) the root
   * matches the pinned Apple Root CA fingerprint, (c) certificates are within
   * their validity window, and (d) the leaf certificate's public key validates
   * the ES256 signature.
   *
   * @throws HttpException(400) on any verification failure.
   */
  private verifyJWS(jws: string): void {
    const parts = jws.split('.');
    if (parts.length !== 3) {
      throw new HttpException('Invalid JWS format', HttpStatus.BAD_REQUEST);
    }

    let header: { alg?: string; x5c?: string[] };
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      );
      // `JSON.parse('null')` (and other non-object JSON) succeeds; guard against
      // it so dereferencing header.alg below cannot throw an unhandled 500.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JWS header must be a JSON object');
      }
      header = parsed;
    } catch {
      throw new HttpException('Invalid JWS header', HttpStatus.BAD_REQUEST);
    }

    if (header.alg !== 'ES256') {
      throw new HttpException(
        `Unsupported JWS algorithm: ${String(header.alg)}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!Array.isArray(header.x5c) || header.x5c.length < 2) {
      throw new HttpException(
        'JWS missing x5c certificate chain',
        HttpStatus.BAD_REQUEST,
      );
    }

    let certs: crypto.X509Certificate[];
    try {
      certs = header.x5c.map(
        (der) => new crypto.X509Certificate(Buffer.from(der, 'base64')),
      );
    } catch {
      throw new HttpException(
        'Invalid certificate in JWS x5c chain',
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = Date.now();
    for (const cert of certs) {
      const notBefore = new Date(cert.validFrom).getTime();
      const notAfter = new Date(cert.validTo).getTime();
      if (Number.isFinite(notBefore) && now < notBefore) {
        throw new HttpException(
          'JWS certificate not yet valid',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (Number.isFinite(notAfter) && now > notAfter) {
        throw new HttpException(
          'JWS certificate expired',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Verify chain: each cert must be signed by the next one up.
    for (let i = 0; i < certs.length - 1; i++) {
      if (!certs[i].verify(certs[i + 1].publicKey)) {
        throw new HttpException(
          'JWS certificate chain verification failed',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Pin the root certificate to Apple's known fingerprint.
    const root = certs[certs.length - 1];
    const rootFingerprint = root.fingerprint256.toUpperCase();
    if (rootFingerprint !== this.rootCaFingerprint) {
      this.logger.error(
        `Apple JWS root CA fingerprint mismatch (got ${rootFingerprint})`,
      );
      throw new HttpException(
        'JWS root certificate is not trusted',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Verify the signature with the leaf certificate's public key. ES256
    // signatures are raw r||s (IEEE P1363), which Node verifies with the
    // 'ieee-p1363' dsaEncoding.
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], 'base64url');
    const verified = crypto.verify(
      'sha256',
      Buffer.from(signingInput),
      { key: certs[0].publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );

    if (!verified) {
      throw new HttpException(
        'JWS signature verification failed',
        HttpStatus.BAD_REQUEST,
      );
    }
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
      const transactionInfo = await this.getTransactionInfo(
        transactionId,
        token,
      );

      if (!transactionInfo) {
        return { success: false };
      }

      // Flag sandbox purchases in production (TestFlight uses sandbox)
      if (
        this.environment === 'production' &&
        transactionInfo.environment === 'Sandbox'
      ) {
        this.logger.warn(
          `Sandbox transaction ${this.sanitizeForLog(transactionId)} verified in production (TestFlight)`,
        );
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
      this.logger.error(
        `Apple verification failed: ${this.errorMessage(error)}`,
      );
      throw new HttpException(
        'Failed to verify Apple App Store purchase',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async getSubscriptionStatus(
    originalTransactionId: string,
  ): Promise<AppleSubscriptionStatus> {
    if (!this.keyId || !this.issuerId || !this.bundleId || !this.privateKey) {
      return {
        autoRenewActive: false,
        error: 'Apple credentials not configured',
      };
    }

    this.logger.log(
      `Checking Apple subscription status for ${this.sanitizeForLog(originalTransactionId)}`,
    );

    try {
      const token = this.generateJWT();
      const primaryHost =
        this.environment === 'production' ? PRODUCTION_HOST : SANDBOX_HOST;
      const fallbackHost =
        this.environment === 'production' ? SANDBOX_HOST : PRODUCTION_HOST;

      let statusData = await this.fetchSubscriptionStatus(
        primaryHost,
        originalTransactionId,
        token,
      );

      // If not found on primary host, try fallback (TestFlight uses sandbox)
      if (!statusData) {
        this.logger.log(
          `Subscription not found on ${primaryHost}, trying ${fallbackHost}`,
        );
        statusData = await this.fetchSubscriptionStatus(
          fallbackHost,
          originalTransactionId,
          token,
        );
      }

      if (!statusData) {
        return { autoRenewActive: false, error: 'Subscription not found' };
      }

      return statusData;
    } catch (error) {
      this.logger.error(
        `Apple subscription status check failed: ${this.errorMessage(error)}`,
      );
      return { autoRenewActive: false, error: this.errorMessage(error) };
    }
  }

  private async fetchSubscriptionStatus(
    hostname: string,
    originalTransactionId: string,
    token: string,
  ): Promise<AppleSubscriptionStatus | null> {
    const requestPath = `/inApps/v1/subscriptions/${originalTransactionId}`;

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          path: requestPath,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(data) as {
                  data: Array<{
                    lastTransactions: Array<{
                      signedRenewalInfo: string;
                      signedTransactionInfo: string;
                    }>;
                  }>;
                };

                // Find the transaction with the latest expiration across all groups
                let latest: AppleSubscriptionStatus | null = null;
                let latestExpMs = -1;

                for (const group of response.data) {
                  for (const tx of group.lastTransactions) {
                    const renewalInfo = this.decodeJWS(
                      tx.signedRenewalInfo,
                    ) as { autoRenewStatus: number };
                    const txInfo = this.decodeJWS(tx.signedTransactionInfo) as {
                      expiresDate?: number;
                    };

                    const expMs = txInfo.expiresDate ?? -1;

                    if (expMs > latestExpMs || !latest) {
                      latestExpMs = expMs;
                      latest = {
                        autoRenewActive: renewalInfo.autoRenewStatus === 1,
                        expirationTime: txInfo.expiresDate
                          ? new Date(txInfo.expiresDate)
                          : null,
                      };
                    }
                  }
                }

                resolve(latest);
              } catch {
                reject(new Error('Failed to parse Apple subscription status'));
              }
            } else if (res.statusCode === 404) {
              resolve(null);
            } else {
              reject(
                new Error(
                  `Apple subscription status API returned ${res.statusCode} from ${hostname}`,
                ),
              );
            }
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(
          new Error(`Apple subscription status request timeout on ${hostname}`),
        );
      });
      req.end();
    });
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

  /**
   * Fetch transaction info from a specific Apple StoreKit API host.
   * Returns the decoded transaction on 200, throws on 404 or other errors.
   */
  private fetchTransactionFromHost(
    hostname: string,
    transactionId: string,
    token: string,
  ): Promise<AppleTransactionInfo | null> {
    const path = `/inApps/v1/transactions/${transactionId}`;

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
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
                const response = JSON.parse(data) as {
                  signedTransactionInfo: string;
                };
                const decoded = this.decodeJWS(response.signedTransactionInfo);
                resolve(decoded as AppleTransactionInfo);
              } catch {
                reject(new Error('Failed to parse Apple response'));
              }
            } else if (res.statusCode === 404) {
              reject(new Error(`Apple API returned 404 from ${hostname}`));
            } else {
              reject(
                new Error(
                  `Apple API returned ${res.statusCode} from ${hostname}`,
                ),
              );
            }
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error(`Apple API request timeout on ${hostname}`));
      });
      req.end();
    });
  }

  /**
   * Get transaction info, trying production first then falling back to sandbox
   * on 401/404 (Apple's recommended pattern for handling TestFlight/sandbox purchases).
   */
  private async getTransactionInfo(
    transactionId: string,
    token: string,
  ): Promise<AppleTransactionInfo | null> {
    const primaryHost =
      this.environment === 'production' ? PRODUCTION_HOST : SANDBOX_HOST;
    const fallbackHost =
      this.environment === 'production' ? SANDBOX_HOST : PRODUCTION_HOST;

    try {
      return await this.fetchTransactionFromHost(
        primaryHost,
        transactionId,
        token,
      );
    } catch (error) {
      const msg = this.errorMessage(error);

      // On 401 or 404, try the other environment (TestFlight uses sandbox)
      if (msg.includes('401') || msg.includes('404')) {
        this.logger.log(
          `Transaction not found on ${primaryHost}, trying ${fallbackHost}`,
        );
        try {
          return await this.fetchTransactionFromHost(
            fallbackHost,
            transactionId,
            token,
          );
        } catch (fallbackError) {
          const fallbackMsg = this.errorMessage(fallbackError);
          // If both hosts return 404, the transaction doesn't exist anywhere
          if (fallbackMsg.includes('404')) {
            this.logger.warn(
              `Transaction not found on either ${primaryHost} or ${fallbackHost}`,
            );
            return null;
          }
          this.logger.error(`Apple API fallback also failed: ${fallbackMsg}`);
          throw fallbackError;
        }
      }

      this.logger.error(`Apple API error: ${msg}`);
      throw error;
    }
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
      offset += derSignature[1] & 0x7f;
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
