import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promisify } from 'util';
import { execFile, type ExecFileOptions } from 'child_process';
import * as path from 'path';

/** Result from Google verification */
export interface GoogleVerificationResult {
  success: boolean;
  platformTxId?: string;
  productId?: string;
  amount?: number | null;
  amountUsd?: number | null;
  currency?: string | null;
  purchaseTime?: Date | null;
  expirationTime?: Date | null;
  isSubscription?: boolean;
  raw?: unknown;
  metadata?: Record<string, unknown>;
}

/** Parameters for verification */
export interface VerifyParams {
  purchaseToken: string;
  productId: string;
  packageName?: string;
}

/** Google subscription purchase data */
interface GoogleSubscriptionPurchase {
  orderId?: string;
  startTimeMillis?: string | number | null;
  expiryTimeMillis?: string | number | null;
  priceAmountMicros?: string;
  priceCurrencyCode?: string;
  acknowledgementState?: number;
  paymentState?: number;
  cancelReason?: number;
}

/** Google one-time product purchase data */
interface GoogleProductPurchase {
  orderId?: string;
  purchaseTimeMillis?: string | number | null;
  consumptionState?: number;
  developerPayload?: string;
  purchaseState?: number;
  priceAmountMicros?: string;
  priceCurrencyCode?: string;
}

interface GooglePythonSuccessResponse {
  success: true;
  isSubscription: boolean;
  data: GoogleSubscriptionPurchase | GoogleProductPurchase;
}

interface GooglePythonErrorResponse {
  success: false;
  error?: string;
  statusCode?: number;
  details?: string;
}

type GooglePythonResponse =
  | GooglePythonSuccessResponse
  | GooglePythonErrorResponse;

const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Service to verify Google Play purchases using a Python script.
 *
 * NOTE: WIF (Workload Identity Federation) authentication is handled by the Python script.
 * The Node.js google-auth-library has bugs with AWS IMDS (metadata service),
 * so we delegate to Python's google-auth library which works correctly.
 */
@Injectable()
export class GoogleVerificationService {
  private readonly logger = new Logger(GoogleVerificationService.name);
  private readonly pythonPath: string;
  private readonly scriptPath: string;

  constructor(private readonly configService: ConfigService) {
    // Use process.cwd() for robustness - works regardless of dist/ structure
    const scriptsDir = path.join(process.cwd(), 'scripts');

    this.pythonPath =
      this.configService.get<string>('PYTHON_PATH') ||
      process.env.PYTHON_PATH ||
      path.join(scriptsDir, '.venv/bin/python3');

    this.scriptPath = path.join(scriptsDir, 'verify_google_purchase.py');
  }

  async verify(params: VerifyParams): Promise<GoogleVerificationResult> {
    const configPackageName = this.configService.get<string>(
      'GOOGLE_PLAY_PACKAGE_NAME',
    );
    const packageName = (params.packageName || configPackageName || '').trim();
    const productId = (params.productId || '').trim();
    const purchaseToken = (params.purchaseToken || '').trim();

    if (!packageName) {
      throw new HttpException(
        'Google Play package name is not configured',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!purchaseToken || !productId) {
      throw new HttpException(
        'purchaseToken and productId are required for Google Play verification',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `Starting Google verification for package ${this.sanitizeForLog(packageName)} product ${this.sanitizeForLog(productId)}`,
    );

    try {
      // Call Python script to verify purchase using WIF
      // Using execFile with array arguments prevents command injection
      this.logger.debug('Executing Python verification script');
      const { stdout, stderr } = await execFileAsync(
        this.pythonPath,
        [this.scriptPath, packageName, productId, purchaseToken],
        {
          timeout: 10000, // 10 second timeout (reduced from 30s)
          encoding: 'utf8',
        },
      );

      if (stderr) {
        this.logger.warn(`Python script stderr received (len=${stderr.length})`);
      }

      // Parse JSON response from Python script
      const result = JSON.parse(stdout.trim()) as GooglePythonResponse;

      if (!result.success) {
        const statusSuffix = result.statusCode
          ? ` (status=${result.statusCode})`
          : '';
        this.logger.error(`Python verification failed${statusSuffix}`);
        throw new HttpException(
          result.error || 'Failed to verify Google Play purchase',
          result.statusCode || HttpStatus.BAD_REQUEST,
        );
      }

      const data = result.data;
      const isSubscription = result.isSubscription;

      // Map Python response to our result format
      if (isSubscription) {
        const subData = data as GoogleSubscriptionPurchase;
        const active = this.isSubscriptionActive(subData);
        return {
          success: active,
          platformTxId: subData.orderId ?? undefined,
          productId,
          amount: subData.priceAmountMicros
            ? Number(subData.priceAmountMicros) / 1_000_000
            : null,
          amountUsd: null,
          currency: subData.priceCurrencyCode ?? null,
          purchaseTime: this.toDate(subData.startTimeMillis),
          expirationTime: this.toDate(subData.expiryTimeMillis),
          isSubscription: true,
          raw: data,
          metadata: {
            acknowledgementState: subData.acknowledgementState,
            paymentState: subData.paymentState,
            cancelReason: subData.cancelReason,
            packageName,
          },
        };
      } else {
        const productData = data as GoogleProductPurchase;
        const active = this.isProductActive(productData);
        return {
          success: active,
          platformTxId: productData.orderId ?? undefined,
          productId,
          amount: productData.priceAmountMicros
            ? Number(productData.priceAmountMicros) / 1_000_000
            : null,
          amountUsd: null,
          currency: productData.priceCurrencyCode ?? null,
          purchaseTime: this.toDate(productData.purchaseTimeMillis),
          expirationTime: null,
          isSubscription: false,
          raw: data,
          metadata: {
            consumptionState: productData.consumptionState,
            developerPayload: productData.developerPayload,
            packageName,
          },
        };
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Google verification failed for package ${this.sanitizeForLog(packageName)} product ${this.sanitizeForLog(productId)}: ${this.errorMessage(error)}`,
      );
      throw new HttpException(
        'Failed to verify Google Play purchase',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private isSubscriptionActive(data: GoogleSubscriptionPurchase): boolean {
    const paymentState = data.paymentState;
    const cancelReason = data.cancelReason;
    const expired =
      data.expiryTimeMillis &&
      Number(data.expiryTimeMillis) > 0 &&
      Date.now() > Number(data.expiryTimeMillis);

    // paymentState: 1=received, 2=free trial, 3=pending deferred
    const paymentOk =
      paymentState === 1 || paymentState === 2 || paymentState === 3;

    return Boolean(paymentOk && cancelReason == null && !expired);
  }

  private isProductActive(data: GoogleProductPurchase): boolean {
    // purchaseState: 0=purchased, 1=canceled, 2=pending
    return data.purchaseState === 0;
  }

  private toDate(value?: string | number | null): Date | null {
    if (!value) return null;
    const num = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(num)) return null;
    return new Date(num);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    const msg =
      (error as Record<string, unknown>)?.message ||
      (error as Record<string, unknown>)?.toString?.();
    return typeof msg === 'string' ? msg : 'Unknown error';
  }

  /** Sanitize value for safe logging (truncate, remove control characters) */
  private sanitizeForLog(value: string, maxLen = 32): string {
    // Remove control characters using Unicode property escape and limit length
    const sanitized = value.replace(/\p{Cc}/gu, '').substring(0, maxLen);
    return value.length > maxLen ? `${sanitized}...` : sanitized;
  }
}
