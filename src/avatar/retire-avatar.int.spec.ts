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
        url: `${tag}_url_${n}`,
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

  it('deletes the row but keeps the asset while a system avatar shares its url', async () => {
    const a = await makeAvatar();
    await prisma.avatar.create({
      data: {
        name: `${tag}_sys_${n++}`,
        url: a.url,
        isSystemAvatar: true,
      },
    });
    await expect(retire(a.id)).resolves.toBeNull();
    expect(await prisma.avatar.count({ where: { id: a.id } })).toBe(0);
  });

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

  describe('replaceAndAssignUserAvatar', () => {
    const repo = new PrismaAvatarRepository(prisma as never);
    const replace = (userId: string, name: string, publicId: string) =>
      repo.replaceAndAssignUserAvatar(userId, name, {
        url: `${tag}_url_${publicId}`,
        publicId,
        isSystemAvatar: false,
      });

    it('creates the row, assigns it and reports no displaced asset', async () => {
      const user = await makeUser();
      const r = await replace(user.id, `${tag}_new_${n++}`, 'first');
      expect(r.displacedPublicId).toBeNull();
      expect(r.user.avatarId).toBe(r.avatar.id);
    });

    it('reports the asset it overwrote, and none when unchanged', async () => {
      const user = await makeUser();
      const name = `${tag}_rep_${n++}`;
      await replace(user.id, name, 'p1');
      expect((await replace(user.id, name, 'p2')).displacedPublicId).toBe('p1');
      expect((await replace(user.id, name, 'p2')).displacedPublicId).toBeNull();
    });

    it('leaves the named row untouched when the assignment fails', async () => {
      const user = await makeUser();
      const name = `${tag}_roll_${n++}`;
      const first = await replace(user.id, name, 'p1');
      await expect(replace(`${tag}_missing`, name, 'p2')).rejects.toBeDefined();
      const row = await prisma.avatar.findUnique({ where: { name } });
      expect(row?.publicId).toBe('p1');
      const reloaded = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(reloaded?.avatarId).toBe(first.avatar.id);
    });

    it('serialises concurrent replacements so every asset is reported exactly once', async () => {
      const user = await makeUser();
      const name = `${tag}_conc_${n++}`;
      await replace(user.id, name, 'p0');
      const results = await Promise.all([
        replace(user.id, name, 'p1'),
        replace(user.id, name, 'p2'),
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
