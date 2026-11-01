import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '@/prisma/prisma.service';
import { SourceCacheService } from '@/source-cache/source-cache.service';
import { GUTENBERG_ALLOWLIST } from './allowlist';
import { GutenbergImportModule } from './gutenberg-import.module';
import {
  formatReport,
  needsProductionConfirmation,
  parseCliArgs,
} from './gutenberg-cli.args';
import { GutenbergImporter } from './gutenberg-importer';
import {
  FsPayloadStore,
  PrismaStoryStore,
  SourceCachePortImpl,
} from './gutenberg-importer.adapters';
import { FilesystemGutenbergSource } from './gutenberg-source';

/**
 * Admin-only operator script (needs shell + DATABASE_URL). No HTTP endpoint.
 *   pnpm import:gutenberg -- --source-dir /path/to/mirror            (dry run)
 *   pnpm import:gutenberg -- --commit --source-dir /path/to/mirror [--only 14838]
 */
async function main(): Promise<number> {
  const logger = new Logger('GutenbergImportCli');
  const args = parseCliArgs(process.argv.slice(2));
  if (
    args.mode === 'commit' &&
    !args.yesProduction &&
    needsProductionConfirmation(process.env.DATABASE_URL)
  ) {
    throw new Error(
      'Refusing --commit: the database host is not clearly local. Pass --yes-production if this is intended',
    );
  }
  const source = new FilesystemGutenbergSource(args.sourceDir);
  const app = await NestFactory.createApplicationContext(
    GutenbergImportModule,
    {
      logger: ['log', 'warn', 'error'],
    },
  );
  try {
    const importer = new GutenbergImporter({
      source,
      cache: new SourceCachePortImpl(app.get(SourceCacheService)),
      store: new PrismaStoryStore(app.get(PrismaService)),
      payloads: new FsPayloadStore(args.cacheDir),
      allowList: GUTENBERG_ALLOWLIST,
      logger,
    });
    const report = await importer.run({
      mode: args.mode,
      only: args.only,
      ttlMs: args.ttlMs,
      allowUnverifiedIds: args.allowUnverifiedIds,
    });
    console.log(formatReport(report));
    return report.summary.error ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`Import failed: ${err.message}`);
    process.exit(1);
  },
);
