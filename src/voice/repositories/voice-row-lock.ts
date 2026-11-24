import type { Prisma } from '@prisma/client';

export async function lockLiveVoiceForReference(
  tx: Prisma.TransactionClient,
  voiceId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM voices WHERE id = ${voiceId} AND "isDeleted" = false FOR SHARE`;
  return rows.length > 0;
}

export async function lockVoiceForDelete(
  tx: Prisma.TransactionClient,
  voiceId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM voices WHERE id = ${voiceId} FOR UPDATE`;
}
