import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PrismaVoiceRepository } from './prisma-voice.repository';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('PrismaVoiceRepository voice deletion (real Postgres)', () => {
  const prisma = new PrismaService();
  const raw = new PrismaClient();
  const repo = new PrismaVoiceRepository(prisma);
  const tag = `vdel_${Date.now()}`;
  let counter = 0;
  let userId: string;
  let voiceId: string;

  const newUser = async () =>
    (
      await raw.user.create({
        data: { email: `${tag}_${counter++}@example.com`, passwordHash: 'x' },
      })
    ).id;

  beforeEach(async () => {
    userId = await newUser();
    const voice = await repo.createVoice({
      userId,
      name: 'Dad',
      type: 'uploaded',
      url: 'https://cdn/v.mp3',
      publicId: `${tag}/v${counter}`,
    });
    voiceId = voice.id;
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

  const isDeleted = async () =>
    (await raw.voice.findUniqueOrThrow({ where: { id: voiceId } })).isDeleted;

  it('stores the public id of an uploaded sample', async () => {
    const voice = await raw.voice.findUniqueOrThrow({ where: { id: voiceId } });
    expect(voice.publicId).toMatch(new RegExp(`^${tag}/v`));
  });

  it('soft-deletes an unreferenced voice for its owner', async () => {
    expect(await repo.softDeleteOwnedIfUnreferenced(voiceId, userId)).toBe(
      true,
    );
    const voice = await raw.voice.findUniqueOrThrow({ where: { id: voiceId } });
    expect(voice.isDeleted).toBe(true);
    expect(voice.deletedAt).toBeInstanceOf(Date);
    expect(await repo.findManyByUserNotDeleted(userId)).toEqual([]);
  });

  it('finds a voice for its owner only, deleted or not', async () => {
    const other = await newUser();
    expect(await repo.findByIdAndUser(voiceId, other)).toBeNull();
    expect((await repo.findByIdAndUser(voiceId, userId))?.isDeleted).toBe(
      false,
    );
    await repo.softDeleteOwnedIfUnreferenced(voiceId, userId);
    expect((await repo.findByIdAndUser(voiceId, userId))?.isDeleted).toBe(true);
  });

  it('reports nothing deleted on a second delete', async () => {
    await repo.softDeleteOwnedIfUnreferenced(voiceId, userId);
    expect(await repo.softDeleteOwnedIfUnreferenced(voiceId, userId)).toBe(
      false,
    );
  });

  it("does not delete another user's voice", async () => {
    const other = await newUser();
    expect(await repo.softDeleteOwnedIfUnreferenced(voiceId, other)).toBe(
      false,
    );
    expect(await isDeleted()).toBe(false);
  });

  it("keeps a voice that is a user's preferred voice", async () => {
    await raw.user.update({
      where: { id: userId },
      data: { preferredVoiceId: voiceId },
    });
    expect(await repo.softDeleteOwnedIfUnreferenced(voiceId, userId)).toBe(
      false,
    );
    expect(await isDeleted()).toBe(false);
  });

  it("keeps a voice that is a kid's preferred voice", async () => {
    await raw.kid.create({
      data: { parentId: userId, name: 'Kid', preferredVoiceId: voiceId },
    });
    expect(await repo.softDeleteOwnedIfUnreferenced(voiceId, userId)).toBe(
      false,
    );
    expect(await isDeleted()).toBe(false);
  });

  it("keeps a voice that is a free user's locked voice", async () => {
    await raw.userUsage.create({
      data: { userId, currentMonth: '2026-11', selectedSecondVoiceId: voiceId },
    });
    expect(await repo.softDeleteOwnedIfUnreferenced(voiceId, userId)).toBe(
      false,
    );
    expect(await isDeleted()).toBe(false);
  });
});
