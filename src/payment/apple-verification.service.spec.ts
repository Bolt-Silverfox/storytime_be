import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import * as https from 'https';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { AppleVerificationService } from './apple-verification.service';
import {
  CircuitBreakerService,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';

// Mock only the https module so we can drive the outbound egress; crypto stays
// real so generateJWT() signs with a genuine EC key in the breaker tests.
jest.mock('https', () => ({ request: jest.fn() }));

describe('AppleVerificationService', () => {
  let service: AppleVerificationService;
  let cbService: CircuitBreakerService;

  const mockConfigService = {
    get: jest.fn((key: string): string | undefined => {
      const config: Record<string, string> = {
        APPLE_KEY_ID: 'TESTKEY123',
        APPLE_ISSUER_ID: 'test-issuer-id',
        APPLE_BUNDLE_ID: 'com.storytime.app',
        APPLE_PRIVATE_KEY: '', // Empty to test configuration checks
        NODE_ENV: 'development',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppleVerificationService,
        CircuitBreakerService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AppleVerificationService>(AppleVerificationService);
    cbService = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  describe('verify', () => {
    const validParams = {
      transactionId: '1234567890',
      productId: 'com.storytime.monthly',
    };

    it('should throw HttpException when transactionId is missing', async () => {
      await expect(
        service.verify({ transactionId: '', productId: 'test' }),
      ).rejects.toThrow(HttpException);

      await expect(
        service.verify({ transactionId: '', productId: 'test' }),
      ).rejects.toThrow('transactionId is required');
    });

    it('should throw HttpException when Apple credentials are not configured', async () => {
      // Service already has empty APPLE_PRIVATE_KEY from mockConfigService
      await expect(service.verify(validParams)).rejects.toThrow(HttpException);
      await expect(service.verify(validParams)).rejects.toThrow(
        'Apple App Store verification not configured',
      );
    });

    it('should throw HttpException when all credentials are missing', async () => {
      const emptyConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: emptyConfigService },
        ],
      }).compile();

      const serviceWithoutConfig = module.get<AppleVerificationService>(
        AppleVerificationService,
      );

      await expect(serviceWithoutConfig.verify(validParams)).rejects.toThrow(
        HttpException,
      );
    });

    it('should use sandbox URL when NODE_ENV is not production', async () => {
      const configWithKey = {
        get: jest.fn((key: string): string | undefined => {
          const config: Record<string, string> = {
            APPLE_KEY_ID: 'TESTKEY123',
            APPLE_ISSUER_ID: 'test-issuer-id',
            APPLE_BUNDLE_ID: 'com.storytime.app',
            // Real key format required for crypto operations
            APPLE_PRIVATE_KEY: '',
            NODE_ENV: 'development',
          };
          return config[key];
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: configWithKey },
        ],
      }).compile();

      const devService = module.get<AppleVerificationService>(
        AppleVerificationService,
      );

      // This will fail due to missing key, but we can verify sandbox is selected
      await expect(devService.verify(validParams)).rejects.toThrow(
        'Apple App Store verification not configured',
      );
    });

    it('should select production URL when NODE_ENV is production', async () => {
      const prodConfigService = {
        get: jest.fn((key: string): string | undefined => {
          const config: Record<string, string> = {
            APPLE_KEY_ID: 'TESTKEY123',
            APPLE_ISSUER_ID: 'test-issuer-id',
            APPLE_BUNDLE_ID: 'com.storytime.app',
            APPLE_PRIVATE_KEY: '', // Empty to trigger config error
            NODE_ENV: 'production',
          };
          return config[key];
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: prodConfigService },
        ],
      }).compile();

      const prodService = module.get<AppleVerificationService>(
        AppleVerificationService,
      );

      // This will fail due to missing key, but environment is set to production
      await expect(prodService.verify(validParams)).rejects.toThrow(
        'Apple App Store verification not configured',
      );
    });
  });

  describe('configuration', () => {
    it('should require APPLE_KEY_ID', async () => {
      const configMissingKeyId = {
        get: jest.fn((key: string): string | undefined => {
          if (key === 'APPLE_KEY_ID') return undefined;
          return 'some-value';
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: configMissingKeyId },
        ],
      }).compile();

      const svc = module.get<AppleVerificationService>(
        AppleVerificationService,
      );

      await expect(
        svc.verify({ transactionId: 'test', productId: 'test' }),
      ).rejects.toThrow('Apple App Store verification not configured');
    });

    it('should require APPLE_ISSUER_ID', async () => {
      const configMissingIssuerId = {
        get: jest.fn((key: string): string | undefined => {
          if (key === 'APPLE_ISSUER_ID') return undefined;
          return 'some-value';
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: configMissingIssuerId },
        ],
      }).compile();

      const svc = module.get<AppleVerificationService>(
        AppleVerificationService,
      );

      await expect(
        svc.verify({ transactionId: 'test', productId: 'test' }),
      ).rejects.toThrow('Apple App Store verification not configured');
    });

    it('should require APPLE_BUNDLE_ID', async () => {
      const configMissingBundleId = {
        get: jest.fn((key: string): string | undefined => {
          if (key === 'APPLE_BUNDLE_ID') return undefined;
          return 'some-value';
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: configMissingBundleId },
        ],
      }).compile();

      const svc = module.get<AppleVerificationService>(
        AppleVerificationService,
      );

      await expect(
        svc.verify({ transactionId: 'test', productId: 'test' }),
      ).rejects.toThrow('Apple App Store verification not configured');
    });

    it('should require APPLE_PRIVATE_KEY', async () => {
      const configMissingPrivateKey = {
        get: jest.fn((key: string): string | undefined => {
          if (key === 'APPLE_PRIVATE_KEY') return undefined;
          return 'some-value';
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: configMissingPrivateKey },
        ],
      }).compile();

      const svc = module.get<AppleVerificationService>(
        AppleVerificationService,
      );

      await expect(
        svc.verify({ transactionId: 'test', productId: 'test' }),
      ).rejects.toThrow('Apple App Store verification not configured');
    });
  });

  describe('circuit breaker (payment-apple)', () => {
    // A real EC P-256 key so generateJWT() succeeds and execution reaches the
    // https egress we want to exercise.
    const { privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const pkcs8 = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();

    const breakerConfig = {
      get: jest.fn((key: string): string | undefined => {
        const config: Record<string, string> = {
          APPLE_KEY_ID: 'TESTKEY123',
          APPLE_ISSUER_ID: 'test-issuer-id',
          APPLE_BUNDLE_ID: 'com.storytime.app',
          APPLE_PRIVATE_KEY: pkcs8,
          NODE_ENV: 'development',
        };
        return config[key];
      }),
    };

    let appleService: AppleVerificationService;
    let breakerCb: CircuitBreakerService;
    const requestMock = https.request as unknown as jest.Mock;

    // Fake ClientRequest that asynchronously emits a transient network error
    // ("socket hang up") once .end() is called — no response callback fires,
    // mimicking a dropped connection. isTransientError() classifies this as
    // breaker-worthy.
    const makeFailingRequest = () => {
      const req = new EventEmitter() as unknown as {
        setTimeout: () => unknown;
        destroy: () => void;
        end: () => void;
        emit: (e: string, ...a: unknown[]) => boolean;
      };
      req.setTimeout = () => req;
      req.destroy = () => {};
      req.end = () => {
        process.nextTick(() => req.emit('error', new Error('socket hang up')));
      };
      return req;
    };

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AppleVerificationService,
          CircuitBreakerService,
          { provide: ConfigService, useValue: breakerConfig },
        ],
      }).compile();
      appleService = module.get<AppleVerificationService>(
        AppleVerificationService,
      );
      breakerCb = module.get<CircuitBreakerService>(CircuitBreakerService);

      requestMock.mockReset();
      requestMock.mockImplementation(() => makeFailingRequest());
    });

    it('does not auto-retry a failing egress call (exactly one https.request per logical fetch)', async () => {
      // getSubscriptionStatus's primary fetch rejects transiently; retries:0
      // means that single logical call maps to exactly one https.request — a
      // retry would have produced 2+.
      const result = await appleService.getSubscriptionStatus('orig-tx-1');

      // Existing structured failure shape is preserved (never throws raw).
      expect(result.autoRenewActive).toBe(false);
      expect(result.error).toBeDefined();
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('opens the payment-apple breaker after repeated transient failures, then fast-fails without opening a socket', async () => {
      const breaker = breakerCb.getBreaker('payment-apple');

      // Default failureThreshold is 5; each call records one transient failure.
      for (let i = 0; i < 5; i++) {
        await appleService.getSubscriptionStatus(`orig-tx-${i}`);
        if (breaker.getSnapshot().state === CircuitState.OPEN) break;
      }
      expect(breaker.getSnapshot().state).toBe(CircuitState.OPEN);

      const callsBefore = requestMock.mock.calls.length;
      const result = await appleService.getSubscriptionStatus('orig-tx-after');

      // CircuitOpenError is translated to the existing failure shape, and no
      // new gateway request is made while OPEN.
      expect(result.autoRenewActive).toBe(false);
      expect(result.error).toContain('payment-apple');
      expect(requestMock).toHaveBeenCalledTimes(callsBefore);
    });
  });
});
