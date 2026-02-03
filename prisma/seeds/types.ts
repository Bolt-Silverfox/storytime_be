import { PrismaClient } from '@prisma/client';

/**
 * Context passed to each seed function
 */
export interface SeedContext {
  prisma: PrismaClient;
  logger: SeedLogger;
}

/**
 * Simple logger interface for seed operations
 */
export interface SeedLogger {
  log: (message: string) => void;
  error: (message: string, error?: unknown) => void;
  success: (message: string) => void;
}

/**
 * Result of a seed operation
 */
export interface SeedResult {
  name: string;
  success: boolean;
  count?: number;
  error?: string;
}

/**
 * Type for a seed function
 */
export type SeedFunction = (ctx: SeedContext) => Promise<SeedResult>;

/**
 * Create a simple console logger for seeding
 */
export function createSeedLogger(prefix: string): SeedLogger {
  return {
    log: (message: string) => console.log(`[${prefix}] ${message}`),
    error: (message: string, error?: unknown) => {
      console.error(`[${prefix}] ✗ ${message}`);
      if (error instanceof Error) {
        console.error(`  └─ ${error.message}`);
      }
    },
    success: (message: string) => console.log(`[${prefix}] ✓ ${message}`),
  };
}
