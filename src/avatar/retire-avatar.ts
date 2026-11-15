import { Prisma } from '@prisma/client';

export async function retireAvatarIfUnreferenced(
  tx: Prisma.TransactionClient,
  avatarId: string,
  expectedPublicId?: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<
    { publicId: string | null; isSystemAvatar: boolean }[]
  >`SELECT "publicId", "isSystemAvatar" FROM avatars WHERE id = ${avatarId} FOR UPDATE`;
  const row = rows[0];
  if (!row || row.isSystemAvatar || !row.publicId) return null;
  if (expectedPublicId !== undefined && row.publicId !== expectedPublicId) {
    return null;
  }

  const [users, kids] = await Promise.all([
    tx.user.count({ where: { avatarId } }),
    tx.kid.count({ where: { avatarId } }),
  ]);
  if (users > 0 || kids > 0) return null;

  const { count } = await tx.avatar.deleteMany({
    where: { id: avatarId, isSystemAvatar: false },
  });
  return count === 1 ? row.publicId : null;
}
