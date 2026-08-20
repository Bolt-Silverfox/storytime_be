import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IPaymentTransactionRepository } from './payment-transaction.repository.interface';
import type { PaymentTransaction, Prisma } from '@prisma/client';

@Injectable()
export class PrismaPaymentTransactionRepository implements IPaymentTransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestSuccessfulByUser(
    userId: string,
  ): Promise<PaymentTransaction | null> {
    return this.prisma.paymentTransaction.findFirst({
      where: { userId, status: 'success' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findFirstByReference(
    reference: string,
  ): Promise<PaymentTransaction | null> {
    return this.prisma.paymentTransaction.findFirst({
      where: { reference },
    });
  }

  async create(
    data: Prisma.PaymentTransactionUncheckedCreateInput,
  ): Promise<PaymentTransaction> {
    return this.prisma.paymentTransaction.create({ data });
  }
}
