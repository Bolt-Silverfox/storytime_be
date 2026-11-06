import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ILoginChallengeRepository,
  NewLoginChallenge,
} from './login-challenge.repository.interface';

const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

@Injectable()
export class PrismaLoginChallengeRepository implements ILoginChallengeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replaceOpenChallenge(data: NewLoginChallenge): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.loginChallenge.updateMany({
        where: {
          emailNormalized: data.emailNormalized,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: data.now },
      }),
      this.prisma.loginChallenge.create({
        data: {
          id: data.id,
          emailNormalized: data.emailNormalized,
          codeHash: data.codeHash,
          linkTokenHash: data.linkTokenHash,
          expiresAt: data.expiresAt,
          requestIpHash: data.requestIpHash,
          createdAt: data.now,
        },
      }),
    ]);
  }

  async findOpenIdByEmail(
    emailNormalized: string,
    now: Date,
  ): Promise<string | null> {
    const row = await this.prisma.loginChallenge.findFirst({
      where: {
        emailNormalized,
        consumedAt: null,
        invalidatedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, attempts: true, maxAttempts: true },
    });
    return row && row.attempts < row.maxAttempts ? row.id : null;
  }

  async recordAttempt(
    id: string,
    now: Date,
  ): Promise<{ codeHash: string } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ codeHash: string }>>`
      UPDATE "login_challenges"
      SET "attempts" = "attempts" + 1
      WHERE "id" = ${id}
        AND "consumedAt" IS NULL
        AND "invalidatedAt" IS NULL
        AND "attempts" < "maxAttempts"
        AND "expiresAt" > ${utc(now)}
      RETURNING "codeHash"`;
    return rows[0] ?? null;
  }

  async consumeById(id: string, now: Date): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ emailNormalized: string }>
    >`
      UPDATE "login_challenges"
      SET "consumedAt" = ${utc(now)}
      WHERE "id" = ${id}
        AND "consumedAt" IS NULL
        AND "invalidatedAt" IS NULL
        AND "expiresAt" > ${utc(now)}
      RETURNING "emailNormalized"`;
    return rows[0]?.emailNormalized ?? null;
  }

  async consumeByLinkTokenHash(
    linkTokenHash: string,
    now: Date,
  ): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ emailNormalized: string }>
    >`
      UPDATE "login_challenges"
      SET "consumedAt" = ${utc(now)}
      WHERE "linkTokenHash" = ${linkTokenHash}
        AND "consumedAt" IS NULL
        AND "invalidatedAt" IS NULL
        AND "expiresAt" > ${utc(now)}
      RETURNING "emailNormalized"`;
    return rows[0]?.emailNormalized ?? null;
  }

  async deleteExpiredBefore(cutoff: Date, limit: number): Promise<number> {
    const batch = await this.prisma.loginChallenge.findMany({
      where: { expiresAt: { lt: cutoff } },
      select: { id: true },
      take: limit,
    });
    if (batch.length === 0) return 0;
    const res = await this.prisma.loginChallenge.deleteMany({
      where: { id: { in: batch.map((r) => r.id) } },
    });
    return res.count;
  }
}
