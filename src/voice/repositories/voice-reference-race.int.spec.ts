import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaKidRepository } from '@/kid/repositories/prisma-kid.repository';
import { PrismaVoiceRepository } from './prisma-voice.repository';
import { PrismaVoiceUserRepository } from './prisma-user.repository';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('voice references racing a voice delete (real Postgres)', () => {
  const prisma = new PrismaService();
  const raw = new PrismaClient();
  const voices = new PrismaVoiceRepository(prisma);
  const users = new PrismaVoiceUserRepository(prisma);
  const kids = new PrismaKidRepository(prisma);
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

  const untilWaitingOnALockOrSettled = async (deletion: Promise<boolean>) => {
    let settled = false;
    const markSettled = () => {
      settled = true;
    };
    deletion.then(markSettled, markSettled);
    while (!settled) {
      const [{ waiting }] = await raw.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE NOT l.granted AND a.query ILIKE '%voices%'`;
      if (waiting > 0n) return;
    }
  };

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

  it('keeps a voice whose reference is written while the delete is in flight', async () => {
    let deleted: Promise<boolean> | undefined;

    await raw.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM voices WHERE id = ${voiceId} FOR SHARE`;
      await tx.user.update({
        where: { id: userId },
        data: { preferredVoiceId: voiceId },
      });
      deleted = softDelete(voiceId);
      await untilWaitingOnALockOrSettled(deleted);
    });

    expect(await deleted).toBe(false);
    expect(await isDeleted(voiceId)).toBe(false);
  });

  it('never leaves a preference pointing at a deleted voice under concurrent writes and deletes', async () => {
    for (let round = 0; round < 5; round++) {
      const id = await newVoice();

      await Promise.all([
        softDelete(id),
        users.updatePreferredVoiceWithInclude(userId, id),
        kids.update(kidId, { preferredVoiceId: id }).catch((error: unknown) => {
          if (!(error instanceof NotFoundException)) throw error;
        }),
      ]);

      const referenced =
        (await userPreference()) === id || (await kidPreference()) === id;
      expect({ round, deleted: await isDeleted(id), referenced }).not.toEqual({
        round,
        deleted: true,
        referenced: true,
      });
    }
  });
});
