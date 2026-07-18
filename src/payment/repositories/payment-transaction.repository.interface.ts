import type { PaymentTransaction, Prisma } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IPaymentTransactionRepository {
  // Find the latest successful payment transaction for a user
  findLatestSuccessfulByUser(
    userId: string,
  ): Promise<PaymentTransaction | null>;

  // Find the first payment transaction by its unique receipt reference
  findFirstByReference(reference: string): Promise<PaymentTransaction | null>;

  // Create a payment transaction
  create(
    data: Prisma.PaymentTransactionUncheckedCreateInput,
  ): Promise<PaymentTransaction>;
}

export const PAYMENT_TRANSACTION_REPOSITORY = Symbol(
  'PAYMENT_TRANSACTION_REPOSITORY',
);
