import { PrismaClient } from '@prisma/client';
import { retireAvatarIfUnreferenced } from './retire-avatar';

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
});
