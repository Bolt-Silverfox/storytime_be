import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import IHealth, { HealthResponse } from 'src/health/Ihealth.interfaces';

@Injectable()
class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, IHealth
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async CheckHealth(): Promise<HealthResponse> {
    const start = Date.now();
    try {
      await this.$queryRaw`SELECT 1;`;

      return {
        service: 'prisma',
        status: 'up',
        message: 'Prisma is up and running',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        service: 'prisma',
        status: 'down',
        message: 'Prisma is down',
        duration: Date.now(),
      };
    }
  }
}
export default PrismaService;
