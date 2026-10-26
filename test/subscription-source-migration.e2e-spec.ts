import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * Runs the real migration SQL against a throwaway schema on the scratch DB
 * (DATABASE_URL) to prove the additive columns and the admin-activated
 * backfill. Skipped when no DATABASE_URL is configured.
 */
const MIGRATION = join(
  __dirname,
  '../prisma/migrations/20261026000001_add_subscription_source_and_grant_fields/migration.sql',
);

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('subscription source migration (real Postgres)', () => {
  const prisma = new PrismaClient();
  const schema = `mig_src_${Date.now()}`;
  const table = `"${schema}"."subscriptions"`;

  // Run the migration's statements against the throwaway schema's table.
  const migrate = async () => {
    const statements = readFileSync(MIGRATION, 'utf8')
      .replace(/"subscriptions"/g, table)
      .split(/;\s*\n/)
      .map((s) =>
        s
          .split('\n')
          .filter((l) => !l.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter(Boolean);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
  };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE ${table} (
         "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "status" TEXT NOT NULL,
         "purchaseToken" TEXT)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${table} ("id","userId","status","purchaseToken") VALUES
        ('a','u1','active','admin-activated-1700000000000'),
        ('b','u2','active','real-google-token'),
        ('c','u3','active',NULL),
        ('d','u4','cancelled','admin-activated-1')`,
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it('adds columns, backfills only admin-activated rows, and is idempotent', async () => {
    await migrate();
    await migrate(); // second run must neither throw nor change data

    const rows = await prisma.$queryRawUnsafe<
      {
        id: string;
        source: string;
        grantedByAdminId: string | null;
        grantReason: string | null;
      }[]
    >(
      `SELECT "id","source","grantedByAdminId","grantReason" FROM ${table} ORDER BY "id"`,
    );
    const none = { grantedByAdminId: null, grantReason: null };
    expect(rows).toEqual([
      { id: 'a', source: 'admin_grant', ...none },
      { id: 'b', source: 'store', ...none },
      { id: 'c', source: 'store', ...none },
      { id: 'd', source: 'admin_grant', ...none },
    ]);
  });
});
