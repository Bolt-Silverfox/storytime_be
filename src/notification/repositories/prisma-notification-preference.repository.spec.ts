import { Prisma } from '@prisma/client';
import { PrismaNotificationPreferenceRepository } from './prisma-notification-preference.repository';
import { PrismaService } from '@/prisma/prisma.service';

type Row = { userId: string; category: string; type: string };

function fakePrisma() {
  let rows: Row[] = [];
  const insert = (data: Row) => {
    const clash = rows.some(
      (r) =>
        r.userId === data.userId &&
        r.category === data.category &&
        r.type === data.type,
    );
    if (clash) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
    rows.push(data);
    return data;
  };
  const lazy = <T>(run: () => T) => ({
    then: (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(run()).then(resolve, reject);
      } catch (e) {
        return Promise.reject(
          e instanceof Error ? e : new Error(String(e)),
        ).then(resolve, reject);
      }
    },
    run,
  });
  const prisma = {
    notificationPreference: {
      create: ({ data }: { data: Row }) => lazy(() => insert(data)),
    },
    $transaction: (ops: { run: () => unknown }[]) => {
      const snapshot = [...rows];
      try {
        return Promise.resolve(ops.map((op) => op.run()));
      } catch (e) {
        rows = snapshot;
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
  };
  return { prisma, rows: () => rows };
}

describe('PrismaNotificationPreferenceRepository.createNotificationPreferencesAtomic', () => {
  const pref = (category: string, userId = 'u1') => ({
    type: 'push' as const,
    category: category as never,
    enabled: true,
    userId,
  });

  it('creates every row when none conflict', async () => {
    const fake = fakePrisma();
    const repo = new PrismaNotificationPreferenceRepository(
      fake.prisma as unknown as PrismaService,
    );
    await repo.createNotificationPreferencesAtomic([pref('A'), pref('B')]);
    expect(fake.rows()).toHaveLength(2);
  });

  it('leaves zero new rows when one create hits P2002', async () => {
    const fake = fakePrisma();
    const repo = new PrismaNotificationPreferenceRepository(
      fake.prisma as unknown as PrismaService,
    );
    await repo.createNotificationPreferencesAtomic([pref('B')]);
    expect(fake.rows()).toHaveLength(1);

    await expect(
      repo.createNotificationPreferencesAtomic([
        pref('A'),
        pref('B'),
        pref('C'),
      ]),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(fake.rows()).toEqual([expect.objectContaining({ category: 'B' })]);
  });
});
