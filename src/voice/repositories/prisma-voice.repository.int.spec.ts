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

  describe('when the owner is paid, so a free-tier lock no longer binds them', () => {
    const lockTo = (lockHolderId: string) =>
      raw.userUsage.create({
        data: {
          userId: lockHolderId,
          currentMonth: '2026-11',
          selectedSecondVoiceId: voiceId,
        },
      });
    const freeTierLock = async (lockHolderId: string) =>
      (
        await raw.userUsage.findUniqueOrThrow({
          where: { userId: lockHolderId },
        })
      ).selectedSecondVoiceId;
    const deleteAsPaidOwner = () =>
      repo.softDeleteOwnedIfUnreferenced(voiceId, userId, {
        releaseOwnersFreeTierLock: true,
      });

    it("deletes a voice held only by the owner's leftover free-tier lock and clears that lock", async () => {
      await lockTo(userId);

      expect(await deleteAsPaidOwner()).toBe(true);
      expect(await isDeleted()).toBe(true);
      expect(await freeTierLock(userId)).toBeNull();
    });

    it("keeps a voice that another user's free-tier lock holds, leaving both locks", async () => {
      const other = await newUser();
      await lockTo(userId);
      await lockTo(other);

      expect(await deleteAsPaidOwner()).toBe(false);
      expect(await isDeleted()).toBe(false);
      expect(await freeTierLock(userId)).toBe(voiceId);
      expect(await freeTierLock(other)).toBe(voiceId);
    });

    it("keeps a voice that is the owner's preferred voice", async () => {
      await raw.user.update({
        where: { id: userId },
        data: { preferredVoiceId: voiceId },
      });
      await lockTo(userId);

      expect(await deleteAsPaidOwner()).toBe(false);
      expect(await freeTierLock(userId)).toBe(voiceId);
    });
  });

  describe('an ElevenLabs id shared with another voice row', () => {
    const CLONE = `${tag}_clone`;
    const setClone = () =>
      raw.voice.update({
        where: { id: voiceId },
        data: { elevenLabsVoiceId: CLONE },
      });

    afterEach(async () => {
      await raw.voice.deleteMany({ where: { elevenLabsVoiceId: CLONE } });
    });

    it('is not shared when only the voice itself carries it', async () => {
      await setClone();
      expect(await repo.isElevenLabsIdUsedByAnotherVoice(CLONE, voiceId)).toBe(
        false,
      );
    });

    it("is shared with another user's registered voice", async () => {
      await setClone();
      await repo.createVoice({
        userId: await newUser(),
        name: 'Registered',
        type: 'elevenlabs',
        elevenLabsVoiceId: CLONE,
      });
      expect(await repo.isElevenLabsIdUsedByAnotherVoice(CLONE, voiceId)).toBe(
        true,
      );
    });

    it('is shared with a system voice', async () => {
      await setClone();
      await repo.createVoice({
        userId: null,
        name: 'System',
        type: 'elevenlabs',
        elevenLabsVoiceId: CLONE,
      });
      expect(await repo.isElevenLabsIdUsedByAnotherVoice(CLONE, voiceId)).toBe(
        true,
      );
    });

    it('is not shared with a deleted voice', async () => {
      await setClone();
      await repo.createVoice({
        userId: await newUser(),
        name: 'Gone',
        type: 'elevenlabs',
        elevenLabsVoiceId: CLONE,
        isDeleted: true,
      });
      expect(await repo.isElevenLabsIdUsedByAnotherVoice(CLONE, voiceId)).toBe(
        false,
      );
    });
  });

  describe('an ElevenLabs id of an uploaded voice', () => {
    const CLONE = `${tag}_uploaded_clone`;
    const setClone = () =>
      raw.voice.update({
        where: { id: voiceId },
        data: { elevenLabsVoiceId: CLONE },
      });

    afterEach(async () => {
      await raw.voice.deleteMany({ where: { elevenLabsVoiceId: CLONE } });
    });

    it('is one while a live uploaded voice carries it', async () => {
      await setClone();
      expect(await repo.isElevenLabsIdOfUploadedVoice(CLONE)).toBe(true);
    });

    it('is still one after the uploaded voice is soft-deleted', async () => {
      await setClone();
      await repo.softDeleteOwnedIfUnreferenced(voiceId, userId);
      expect(await repo.isElevenLabsIdOfUploadedVoice(CLONE)).toBe(true);
    });

    it('is not one once the uploaded voice has forgotten it', async () => {
      await setClone();
      await repo.clearElevenLabsVoiceId(voiceId, userId);
      expect(await repo.isElevenLabsIdOfUploadedVoice(CLONE)).toBe(false);
    });

    it('is not one when only registered and system voices carry it', async () => {
      await repo.createVoice({
        userId: await newUser(),
        name: 'Registered',
        type: 'elevenlabs',
        elevenLabsVoiceId: CLONE,
      });
      await repo.createVoice({
        userId: null,
        name: 'System',
        type: 'elevenlabs',
        elevenLabsVoiceId: CLONE,
      });
      expect(await repo.isElevenLabsIdOfUploadedVoice(CLONE)).toBe(false);
    });
  });

  it("forgets a voice's ElevenLabs id for its owner", async () => {
    await raw.voice.update({
      where: { id: voiceId },
      data: { elevenLabsVoiceId: 'clone-1' },
    });

    await repo.clearElevenLabsVoiceId(voiceId, userId);

    const voice = await raw.voice.findUniqueOrThrow({ where: { id: voiceId } });
    expect(voice.elevenLabsVoiceId).toBeNull();
  });

  it("leaves another user's ElevenLabs id alone", async () => {
    const other = await newUser();
    await raw.voice.update({
      where: { id: voiceId },
      data: { elevenLabsVoiceId: 'clone-1' },
    });

    await repo.clearElevenLabsVoiceId(voiceId, other);

    const voice = await raw.voice.findUniqueOrThrow({ where: { id: voiceId } });
    expect(voice.elevenLabsVoiceId).toBe('clone-1');
  });
});
