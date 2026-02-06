import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { GoogleVerificationService } from './google-verification.service';

// Create a mock function that will be set up in beforeEach
let mockExecAsync: jest.Mock;

// Mock the entire module
jest.mock('util', () => {
  const originalUtil = jest.requireActual('util');
  return {
    ...originalUtil,
    promisify: jest.fn(() => {
      return (...args: unknown[]) => mockExecAsync(...args);
    }),
  };
});

describe('GoogleVerificationService', () => {
  let service: GoogleVerificationService;

  const mockConfigService = {
    get: jest.fn((key: string): string | undefined => {
      const config: Record<string, string> = {
        GOOGLE_PLAY_PACKAGE_NAME: 'com.storytime.app',
        PYTHON_PATH: '/usr/bin/python3',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockExecAsync = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleVerificationService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<GoogleVerificationService>(GoogleVerificationService);
  });

  describe('verify', () => {
    const validParams = {
      purchaseToken: 'valid-token-123',
      productId: 'com.storytime.monthly',
    };

    it('should verify a valid subscription purchase', async () => {
      const mockResponse = {
        success: true,
        isSubscription: true,
        data: {
          orderId: 'GPA.1234-5678-9012',
          startTimeMillis: '1704067200000',
          expiryTimeMillis: String(Date.now() + 86400000 * 30),
          priceAmountMicros: '4990000',
          priceCurrencyCode: 'USD',
          paymentState: 1,
          acknowledgementState: 1,
        },
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: '',
      });

      const result = await service.verify(validParams);

      expect(result.success).toBe(true);
      expect(result.isSubscription).toBe(true);
      expect(result.platformTxId).toBe('GPA.1234-5678-9012');
      expect(result.amount).toBe(4.99);
      expect(result.currency).toBe('USD');
      expect(result.expirationTime).toBeInstanceOf(Date);
    });

    it('should verify a valid one-time product purchase', async () => {
      const mockResponse = {
        success: true,
        isSubscription: false,
        data: {
          orderId: 'GPA.9999-8888-7777',
          purchaseTimeMillis: '1704067200000',
          purchaseState: 0,
          priceAmountMicros: '990000',
          priceCurrencyCode: 'USD',
        },
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: '',
      });

      const result = await service.verify(validParams);

      expect(result.success).toBe(true);
      expect(result.isSubscription).toBe(false);
      expect(result.platformTxId).toBe('GPA.9999-8888-7777');
      expect(result.amount).toBe(0.99);
    });

    it('should return success=false for expired subscription', async () => {
      const pastDate = Date.now() - 86400000;
      const mockResponse = {
        success: true,
        isSubscription: true,
        data: {
          orderId: 'GPA.1234-5678-9012',
          startTimeMillis: '1704067200000',
          expiryTimeMillis: String(pastDate),
          paymentState: 1,
        },
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: '',
      });

      const result = await service.verify(validParams);

      expect(result.success).toBe(false);
    });

    it('should return success=false for cancelled subscription', async () => {
      const mockResponse = {
        success: true,
        isSubscription: true,
        data: {
          orderId: 'GPA.1234-5678-9012',
          expiryTimeMillis: String(Date.now() + 86400000),
          paymentState: 1,
          cancelReason: 1,
        },
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: '',
      });

      const result = await service.verify(validParams);

      expect(result.success).toBe(false);
    });

    it('should throw HttpException when Python script returns error', async () => {
      const mockResponse = {
        success: false,
        error: 'Invalid purchase token',
        statusCode: 400,
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: '',
      });

      await expect(service.verify(validParams)).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when purchaseToken is missing', async () => {
      await expect(
        service.verify({ purchaseToken: '', productId: 'test' }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when productId is missing', async () => {
      await expect(
        service.verify({ purchaseToken: 'token', productId: '' }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw HttpException when package name is not configured', async () => {
      const emptyConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoogleVerificationService,
          { provide: ConfigService, useValue: emptyConfigService },
        ],
      }).compile();

      const serviceWithoutConfig = module.get<GoogleVerificationService>(
        GoogleVerificationService,
      );

      await expect(serviceWithoutConfig.verify(validParams)).rejects.toThrow(
        HttpException,
      );
    });

    it('should handle Python script execution error', async () => {
      mockExecAsync.mockRejectedValue(new Error('Script execution failed'));

      await expect(service.verify(validParams)).rejects.toThrow(HttpException);
    });

    it('should handle invalid JSON response from Python script', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'not valid json',
        stderr: '',
      });

      await expect(service.verify(validParams)).rejects.toThrow(HttpException);
    });

    it('should use packageName from params if provided', async () => {
      const mockResponse = {
        success: true,
        isSubscription: true,
        data: {
          orderId: 'GPA.1234',
          paymentState: 1,
          expiryTimeMillis: String(Date.now() + 86400000),
        },
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: '',
      });

      await service.verify({
        ...validParams,
        packageName: 'com.custom.package',
      });

      // Verify execFile was called with array args containing the custom package
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String), // Python path
        expect.arrayContaining(['com.custom.package']),
        expect.any(Object),
      );
    });

    it('should log warning when stderr is present', async () => {
      const mockResponse = {
        success: true,
        isSubscription: false,
        data: { orderId: 'test', purchaseState: 0 },
      };

      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify(mockResponse),
        stderr: 'Some warning message',
      });

      const result = await service.verify(validParams);

      expect(result.success).toBe(true);
    });
  });
});
