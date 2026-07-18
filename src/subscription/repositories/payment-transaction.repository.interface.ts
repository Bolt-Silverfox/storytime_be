import type { PaymentTransaction } from '@prisma/client';

// ==================== Repository Interface ====================
export interface IPaymentTransactionRepository {
  // Find all payment transactions for a user, ordered by createdAt desc
  findManyByUser(userId: string): Promise<PaymentTransaction[]>;
}

export const PAYMENT_TRANSACTION_REPOSITORY = Symbol(
  'PAYMENT_TRANSACTION_REPOSITORY',
);
