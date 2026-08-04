import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Prevent hot-reload (HMR / watch mode) from spawning duplicate query-engine processes.
// Each `new PrismaClient()` starts a child query-engine binary; without this guard,
// every HMR cycle leaks one.
const globalForPrisma = globalThis as unknown as {
  __prismaService?: PrismaService;
};

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => {
        if (!globalForPrisma.__prismaService) {
          globalForPrisma.__prismaService = new PrismaService();
        }
        return globalForPrisma.__prismaService;
      },
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
