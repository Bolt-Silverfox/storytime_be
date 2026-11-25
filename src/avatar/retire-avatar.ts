import { Prisma } from '@prisma/client';

export async function retireAvatarIfUnreferenced(
  tx: Prisma.TransactionClient,
  avatarId: string,
  expectedPublicId?: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<
    { publicId: string | null; isSystemAvatar: boolean; url: string }[]
  >`SELECT "publicId", "isSystemAvatar", url FROM avatars WHERE id = ${avatarId} FOR UPDATE`;
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
  if (count !== 1) return null;
  const sharesAsset = await tx.avatar.count({
    where: {
      id: { not: avatarId },
      OR: [{ url: row.url }, { publicId: row.publicId }],
    },
  });
  return sharesAsset > 0 ? null : row.publicId;
}
