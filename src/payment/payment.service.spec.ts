import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { IapVerifierFactory } from './strategies/iap-verifier.factory';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IapPlatform } from './dto/verify-purchase.dto';
import { IapVerifier } from './strategies/iap-verifier.interface';
import { PAYMENT_CONSTANTS } from './payment.constants';
import { PrismaClient } from '@prisma/client';

// Define Mock Prisma Singleton with explicit `any` type to avoid recursive reference errors
const mockPrismaSingleton: any = {
    user: {
        findUnique: jest.fn(),
    },
    paymentMethod: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
    },
    paymentTransaction: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
    },
    subscription: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => {
        // Mock implementation of $transaction
        // If it's a function (Interactive Transaction), execute it with the mock client
        if (typeof callback === 'function') {
            return callback(mockPrismaSingleton);
        }
        // If it's an array (Sequential operations), simple resolve
        return Promise.all(callback);
    }),
};

jest.mock('@prisma/client', () => {
    return {
        PrismaClient: jest.fn(() => mockPrismaSingleton),
    };
});

describe('PaymentService', () => {
    let service: PaymentService;
    let factory: IapVerifierFactory;
    let mockPrisma: any;

    const mockVerifier: IapVerifier = {
        verify: jest.fn(),
        getPlatform: jest.fn(),
    };

    beforeEach(async () => {
        // Get the singleton instance
        mockPrisma = new PrismaClient();

        // Clear all mocks
        jest.clearAllMocks();

        // Default behavior: No duplicate transaction found (findUnique returns null)
        mockPrisma.paymentTransaction.findUnique.mockResolvedValue(null);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentService,
                {
                    provide: IapVerifierFactory,
                    useValue: {
                        getVerifier: jest.fn().mockReturnValue(mockVerifier),
                    },
                },
            ],
        }).compile();

        service = module.get<PaymentService>(PaymentService);
        factory = module.get<IapVerifierFactory>(IapVerifierFactory);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('verifyPurchase', () => {
        it('should verify purchase and create subscription for valid receipt', async () => {
            // Arrange
            const userId = 'user-1';
            const dto = {
                platform: IapPlatform.ANDROID,
                productId: 'monthly',
                receipt: 'valid-token',
            };

            (mockVerifier.verify as jest.Mock).mockResolvedValue(true);

            mockPrisma.paymentTransaction.create.mockResolvedValue({ id: 'tx-1' });
            mockPrisma.subscription.findFirst.mockResolvedValue(null); // No existing sub
            mockPrisma.subscription.create.mockResolvedValue({ id: 'sub-1' });

            // Act
            const result = await service.verifyPurchase(userId, dto);

            // Assert
            expect(factory.getVerifier).toHaveBeenCalledWith(IapPlatform.ANDROID);
            expect(mockVerifier.verify).toHaveBeenCalledWith('monthly', 'valid-token');
            expect(mockPrisma.paymentTransaction.create).toHaveBeenCalled();
            expect(mockPrisma.subscription.create).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.subscription.plan).toBe('monthly');
        });

        it('should handle duplicate receipt successfully (idempotency)', async () => {
            // Arrange
            const userId = 'user-1';
            // Same receipt as another transaction
            const dto = {
                platform: IapPlatform.ANDROID,
                productId: 'monthly',
                receipt: 'duplicate-token',
            };

            (mockVerifier.verify as jest.Mock).mockResolvedValue(true);

            // Simulate existing transaction found by findUnique
            mockPrisma.paymentTransaction.findUnique.mockResolvedValue({
                id: 'tx-existing',
                status: 'SUCCESS',
                reference: 'iap-android-hash'
            });

            // Simulate return of existing subscription
            mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', plan: 'monthly' });

            // Act
            const result = await service.verifyPurchase(userId, dto);

            // Assert
            // Should verify first
            expect(mockVerifier.verify).toHaveBeenCalled();
            // Should check for existing transaction via findUnique
            expect(mockPrisma.paymentTransaction.findUnique).toHaveBeenCalled();
            // Should NOT create new transaction
            expect(mockPrisma.paymentTransaction.create).not.toHaveBeenCalled();
            // Should return success with existing details
            expect(result.success).toBe(true);
            expect(result.transaction.id).toBe('tx-existing');
        });

        it('should throw BadRequestException if verification fails', async () => {
            const userId = 'user-1';
            const dto = {
                platform: IapPlatform.IOS,
                productId: 'monthly',
                receipt: 'invalid-receipt',
            };

            (mockVerifier.verify as jest.Mock).mockResolvedValue(false);

            await expect(service.verifyPurchase(userId, dto)).rejects.toThrow(BadRequestException);
        });

        it('should map complex product IDs to internal plans', async () => {
            const userId = 'user-1';
            const dto = {
                platform: IapPlatform.ANDROID,
                productId: 'com.storytime.yearly_sub',
                receipt: 'token',
            };

            (mockVerifier.verify as jest.Mock).mockResolvedValue(true);
            mockPrisma.paymentTransaction.create.mockResolvedValue({ id: 'tx-1' });
            mockPrisma.subscription.findFirst.mockResolvedValue(null);

            await service.verifyPurchase(userId, dto);

            // Should have mapped '...yearly...' to 'yearly'
            expect(mockPrisma.paymentTransaction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        amount: PAYMENT_CONSTANTS.PLANS.yearly.amount
                    })
                })
            );
        });
    });

    describe('chargeSubscription', () => {
        it('should return error for invalid plan', async () => {
            await expect(service.chargeSubscription('u1', { plan: 'invalid' }))
                .rejects.toThrow(BadRequestException);
        });

        it('should fail if user not found', async () => {
            mockPrisma.user.findUnique.mockResolvedValue(null);
            await expect(service.chargeSubscription('u1', { plan: 'monthly' }))
                .rejects.toThrow(NotFoundException);
        });
    });
});
