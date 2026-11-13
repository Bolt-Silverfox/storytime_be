import { PrismaClient } from '@prisma/client';
import { retireAvatarIfUnreferenced } from './retire-avatar';
import { PrismaAvatarRepository } from './repositories/prisma-avatar.repository';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('retireAvatarIfUnreferenced (real Postgres)', () => {
  const prisma = new PrismaClient();
  const tag = `ret_${Date.now()}`;
  let n = 0;

  const makeAvatar = () =>
    prisma.avatar.create({
      data: {
        name: `${tag}_${n++}`,
        url: 'u',
        publicId: `${tag}_pid_${n}`,
        isSystemAvatar: false,
      },
    });
  const makeUser = (avatarId?: string) =>
    prisma.user.create({
      data: { email: `${tag}_${n++}@example.com`, passwordHash: 'x', avatarId },
    });

  afterAll(async () => {
    await prisma.kid.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.avatar.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  const retire = (id: string) =>
    prisma.$transaction((tx) => retireAvatarIfUnreferenced(tx, id));

  it('deletes an unreferenced avatar and returns its asset id', async () => {
    const a = await makeAvatar();
    await expect(retire(a.id)).resolves.toBe(a.publicId);
    expect(await prisma.avatar.count({ where: { id: a.id } })).toBe(0);
  });

  it('keeps an avatar another user still uses', async () => {
    const a = await makeAvatar();
    await makeUser(a.id);
    await expect(retire(a.id)).resolves.toBeNull();
    expect(await prisma.avatar.count({ where: { id: a.id } })).toBe(1);
  });

  it('keeps an avatar a kid still uses', async () => {
    const a = await makeAvatar();
    const parent = await makeUser();
    await prisma.kid.create({
      data: { name: `${tag}_kid`, parentId: parent.id, avatarId: a.id },
    });
    await expect(retire(a.id)).resolves.toBeNull();
    expect(await prisma.avatar.count({ where: { id: a.id } })).toBe(1);
  });

  it('blocks a concurrent assignment until the retirement commits, then refuses it', async () => {
    const a = await makeAvatar();
    const user = await makeUser();
    let assignSettled = false;
    let assign: Promise<unknown> = Promise.resolve();
    const publicId = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM avatars WHERE id = ${a.id} FOR UPDATE`;
      assign = prisma.user
        .update({ where: { id: user.id }, data: { avatarId: a.id } })
        .finally(() => {
          assignSettled = true;
        });
      assign.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 400));
      expect(assignSettled).toBe(false);
      return retireAvatarIfUnreferenced(tx, a.id);
    });
    expect(publicId).toBe(a.publicId);
    await expect(assign).rejects.toBeDefined();
    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded?.avatarId).toBeNull();
  });

  describe('replaceByName', () => {
    const repo = new PrismaAvatarRepository(prisma as never);
    const replace = (name: string, publicId: string) =>
      repo.replaceByName(name, {
        url: 'u',
        publicId,
        isSystemAvatar: false,
      });

    it('reports no displaced asset when it creates the row', async () => {
      const r = await replace(`${tag}_new_${n++}`, 'first');
      expect(r.displacedPublicId).toBeNull();
    });

    it('reports the asset it overwrote, and none when unchanged', async () => {
      const name = `${tag}_rep_${n++}`;
      await replace(name, 'p1');
      expect((await replace(name, 'p2')).displacedPublicId).toBe('p1');
      expect((await replace(name, 'p2')).displacedPublicId).toBeNull();
    });

    it('serialises concurrent replacements so every asset is reported exactly once', async () => {
      const name = `${tag}_conc_${n++}`;
      await replace(name, 'p0');
      const results = await Promise.all([
        replace(name, 'p1'),
        replace(name, 'p2'),
      ]);
      const displaced = results.map((r) => r.displacedPublicId).sort();
      const finalRow = await prisma.avatar.findUnique({ where: { name } });
      expect([...displaced, finalRow?.publicId].sort()).toEqual([
        'p0',
        'p1',
        'p2',
      ]);
    });
  });
});
