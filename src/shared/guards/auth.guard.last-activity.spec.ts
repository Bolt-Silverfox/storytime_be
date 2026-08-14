import { AuthSessionGuard } from './auth.guard';

const THRESHOLD_MS = 60_000;

function makeGuard(session: Record<string, unknown>) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    session: { findUnique: jest.fn().mockResolvedValue(session), update },
  } as never;
  const jwt = {
    verify: jest.fn().mockReturnValue({ userId: 'u1', authSessionId: 'sess1' }),
  } as never;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as never;
  const guard = new AuthSessionGuard(jwt, reflector, prisma);
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer t' } }),
    }),
    getHandler: () => null,
    getClass: () => null,
  } as never;
  return { guard, update, ctx };
}

const baseSession = {
  id: 'sess1',
  isDeleted: false,
  deletedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(Date.now() - 7_200_000),
};

it('bumps lastActivityAt when null', async () => {
  const { guard, update, ctx } = makeGuard({
    ...baseSession,
    lastActivityAt: null,
  });
  await guard.canActivate(ctx);
  await new Promise((r) => setImmediate(r)); // let the fire-and-forget settle
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'sess1' },
      data: expect.objectContaining({ lastActivityAt: expect.any(Date) }),
    }),
  );
});

it('bumps when lastActivityAt is stale (> 60s)', async () => {
  const { guard, update, ctx } = makeGuard({
    ...baseSession,
    lastActivityAt: new Date(Date.now() - THRESHOLD_MS - 1000),
  });
  await guard.canActivate(ctx);
  await new Promise((r) => setImmediate(r));
  expect(update).toHaveBeenCalled();
});

it('does NOT bump when lastActivityAt is fresh (< 60s)', async () => {
  const { guard, update, ctx } = makeGuard({
    ...baseSession,
    lastActivityAt: new Date(Date.now() - 5000),
  });
  await guard.canActivate(ctx);
  await new Promise((r) => setImmediate(r));
  expect(update).not.toHaveBeenCalled();
});
