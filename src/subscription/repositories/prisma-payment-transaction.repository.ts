import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { IPaymentTransactionRepository } from './payment-transaction.repository.interface';
import type { PaymentTransaction } from '@prisma/client';

@Injectable()
export class PrismaPaymentTransactionRepository
  implements IPaymentTransactionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async findManyByUser(userId: string): Promise<PaymentTransaction[]> {
    return this.prisma.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
