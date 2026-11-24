import { NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaKidRepository } from '@/kid/repositories/prisma-kid.repository';
import { PrismaVoiceRepository } from './prisma-voice.repository';
import { PrismaVoiceUserRepository } from './prisma-user.repository';
import { PrismaUserUsageRepository } from './prisma-user-usage.repository';
import {
  lockLiveVoiceForReference,
  lockVoiceForDelete,
} from './voice-row-lock';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('voice references racing a voice delete (real Postgres)', () => {
  const prisma = new PrismaService();
  const raw = new PrismaClient();
  const voices = new PrismaVoiceRepository(prisma);
  const users = new PrismaVoiceUserRepository(prisma);
  const kids = new PrismaKidRepository(prisma);
  const usages = new PrismaUserUsageRepository(prisma);
  const tag = `vrace_${Date.now()}`;
  let counter = 0;
  let userId: string;
  let kidId: string;
  let voiceId: string;

  const newVoice = async () =>
    (
      await voices.createVoice({
        userId,
        name: 'Dad',
        type: 'uploaded',
        url: 'https://cdn/v.mp3',
      })
    ).id;

  beforeEach(async () => {
    userId = (
      await raw.user.create({
        data: { email: `${tag}_${counter++}@example.com`, passwordHash: 'x' },
      })
    ).id;
    kidId = (await raw.kid.create({ data: { parentId: userId, name: 'Kid' } }))
      .id;
    voiceId = await newVoice();
    await raw.userUsage.create({ data: { userId, currentMonth: '2026-11' } });
  });

  afterEach(async () => {
    await raw.kid.deleteMany({
      where: { parent: { email: { startsWith: tag } } },
    });
    await raw.user.updateMany({
      where: { email: { startsWith: tag } },
      data: { preferredVoiceId: null },
    });
    await raw.user.deleteMany({ where: { email: { startsWith: tag } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await raw.$disconnect();
  });

  const softDelete = (id: string) =>
    voices.softDeleteOwnedIfUnreferenced(id, userId);
  const isDeleted = async (id: string) =>
    (await raw.voice.findUniqueOrThrow({ where: { id } })).isDeleted;
  const userPreference = async () =>
    (await raw.user.findUniqueOrThrow({ where: { id: userId } }))
      .preferredVoiceId;
  const kidPreference = async () =>
    (await raw.kid.findUniqueOrThrow({ where: { id: kidId } }))
      .preferredVoiceId;
  const freeTierLock = async () =>
    (await raw.userUsage.findUniqueOrThrow({ where: { userId } }))
      .selectedSecondVoiceId;

  const BLOCKED_WAIT_LIMIT_MS = 5000;

  const untilBlockedByOrSettled = async (
    lockHolderPid: number,
    contender: Promise<unknown>,
  ) => {
    let settled = false;
    const markSettled = () => {
      settled = true;
    };
    contender.then(markSettled, markSettled);
    const deadline = Date.now() + BLOCKED_WAIT_LIMIT_MS;
    while (!settled) {
      const [{ blocked }] = await raw.$queryRaw<{ blocked: bigint }[]>`
        SELECT count(*) AS blocked FROM pg_stat_activity
        WHERE ${lockHolderPid}::int = ANY(pg_blocking_pids(pid))`;
      if (blocked > 0n) return;
      if (Date.now() > deadline) {
        throw new Error(
          `the contender neither settled nor waited on backend ${lockHolderPid} within ${BLOCKED_WAIT_LIMIT_MS}ms`,
        );
      }
    }
  };

  const contendWhileHolding = async <T>(
    lockAndWrite: (tx: Prisma.TransactionClient) => Promise<unknown>,
    contend: () => Promise<T>,
  ): Promise<T> => {
    let contender: Promise<T> | undefined;
    await raw.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      await lockAndWrite(tx);
      contender = contend();
      await untilBlockedByOrSettled(pid, contender);
    });
    return contender as Promise<T>;
  };

  const deleteWhileHoldingAReferenceLock = (
    writeReference: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) =>
    contendWhileHolding(
      async (tx) => {
        expect(await lockLiveVoiceForReference(tx, voiceId)).toBe(true);
        await writeReference(tx);
      },
      () => softDelete(voiceId),
    );

  const referenceWhileADeleteIsInFlight = <T>(
    writeReference: () => Promise<T>,
  ) =>
    contendWhileHolding(async (tx) => {
      await lockVoiceForDelete(tx, voiceId);
      await tx.voice.update({
        where: { id: voiceId },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    }, writeReference);

  it("sets a live voice as the user's preferred voice", async () => {
    const user = await users.updatePreferredVoiceWithInclude(userId, voiceId);

    expect(user?.preferredVoice?.id).toBe(voiceId);
    expect(await userPreference()).toBe(voiceId);
  });

  it("does not point a user's preference at a voice deleted after it was read", async () => {
    await softDelete(voiceId);

    expect(
      await users.updatePreferredVoiceWithInclude(userId, voiceId),
    ).toBeNull();
    expect(await userPreference()).toBeNull();
  });

  it("sets a live voice as a kid's preferred voice", async () => {
    const kid = await kids.update(kidId, { preferredVoiceId: voiceId });

    expect(kid.preferredVoice?.id).toBe(voiceId);
  });

  it("does not point a kid's preference at a voice deleted after it was read", async () => {
    await softDelete(voiceId);

    await expect(
      kids.update(kidId, { name: 'Renamed', preferredVoiceId: voiceId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await kidPreference()).toBeNull();
    expect(
      (await raw.kid.findUniqueOrThrow({ where: { id: kidId } })).name,
    ).toBe('Kid');
  });

  it("locks a live voice as a free user's voice", async () => {
    expect(await usages.lockSecondVoiceIfNull(userId, voiceId)).toEqual({
      count: 1,
    });
    expect(await freeTierLock()).toBe(voiceId);
  });

  it('does not lock a free user to a voice deleted after it was resolved', async () => {
    await softDelete(voiceId);

    expect(await usages.lockSecondVoiceIfNull(userId, voiceId)).toEqual({
      count: 0,
    });
    expect(await freeTierLock()).toBeNull();
  });

  it('keeps a voice whose reference is written while the delete is in flight', async () => {
    const deleted = await deleteWhileHoldingAReferenceLock((tx) =>
      tx.user.update({
        where: { id: userId },
        data: { preferredVoiceId: voiceId },
      }),
    );

    expect(deleted).toBe(false);
    expect(await isDeleted(voiceId)).toBe(false);
  });

  it('keeps a voice whose free-tier lock is written while the delete is in flight', async () => {
    const deleted = await deleteWhileHoldingAReferenceLock((tx) =>
      tx.userUsage.update({
        where: { userId },
        data: { selectedSecondVoiceId: voiceId },
      }),
    );

    expect(deleted).toBe(false);
    expect(await isDeleted(voiceId)).toBe(false);
  });

  it('does not lock a free user to a voice whose delete commits while the write waits', async () => {
    const locked = await referenceWhileADeleteIsInFlight(() =>
      usages.lockSecondVoiceIfNull(userId, voiceId),
    );

    expect(locked).toEqual({ count: 0 });
    expect(await freeTierLock()).toBeNull();
  });

  it("does not point a user's preference at a voice whose delete commits while the write waits", async () => {
    const user = await referenceWhileADeleteIsInFlight(() =>
      users.updatePreferredVoiceWithInclude(userId, voiceId),
    );

    expect(user).toBeNull();
    expect(await userPreference()).toBeNull();
  });

  it('never leaves a reference pointing at a deleted voice under concurrent writes and deletes', async () => {
    for (let round = 0; round < 5; round++) {
      const id = await newVoice();
      await raw.userUsage.update({
        where: { userId },
        data: { selectedSecondVoiceId: null },
      });

      await Promise.all([
        softDelete(id),
        usages.lockSecondVoiceIfNull(userId, id),
        users.updatePreferredVoiceWithInclude(userId, id),
        kids.update(kidId, { preferredVoiceId: id }).catch((error: unknown) => {
          if (!(error instanceof NotFoundException)) throw error;
        }),
      ]);

      const referenced =
        (await userPreference()) === id ||
        (await kidPreference()) === id ||
        (await freeTierLock()) === id;
      expect({ round, deleted: await isDeleted(id), referenced }).not.toEqual({
        round,
        deleted: true,
        referenced: true,
      });
    }
  });
});
