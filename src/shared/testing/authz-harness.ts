import { INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthSessionGuard, JwtPayload } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { AccessControlService } from '@/shared/access/access-control.service';

export const ALICE = '11111111-1111-4111-8111-111111111111';
export const BOB = '22222222-2222-4222-8222-222222222222';
export const ADMIN = '33333333-3333-4333-8333-333333333333';
export const ALICE_KID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const BOB_KID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PAYLOADS: Record<string, JwtPayload> = {
  alice: payload(ALICE, 'user'),
  bob: payload(BOB, 'user'),
  admin: payload(ADMIN, 'admin'),
};

const KIDS = [
  { id: ALICE_KID, parentId: ALICE },
  { id: BOB_KID, parentId: BOB },
];

function payload(userId: string, userRole: string): JwtPayload {
  return {
    userId,
    userRole,
    email: `${userId}@example.com`,
    expiry: 0,
    authSessionId: `session-${userId}`,
  };
}

export type Who = 'alice' | 'bob' | 'admin';

export const bearer = (who: Who) => `Bearer ${who}`;

export const HASH_SENTINELS = {
  passwordHash: '$2b$10$passwordhashsentinel',
  pinHash: '$2b$10$pinhashsentinel',
};

export async function createAuthzApp(
  controllers: Type<unknown>[],
  providers: unknown[],
): Promise<INestApplication> {
  const jwt = {
    verify: (token: string) => {
      const found = PAYLOADS[token];
      if (!found) throw new Error('invalid token');
      return found;
    },
  };
  const prisma = {
    session: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'session',
        deletedAt: null,
        isDeleted: false,
        expiresAt: new Date(Date.now() + 3_600_000),
        lastActivityAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    kid: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string; parentId?: string } }) =>
          Promise.resolve(
            KIDS.find(
              (k) =>
                k.id === where.id &&
                (where.parentId === undefined || k.parentId === where.parentId),
            ) ?? null,
          ),
      ),
    },
  };
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: [
      AuthSessionGuard,
      AdminGuard,
      AccessControlService,
      { provide: JwtService, useValue: jwt },
      { provide: PrismaService, useValue: prisma },
      ...(providers as never[]),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
