import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SseAuthGuard } from './sse-auth.guard';

describe('SseAuthGuard', () => {
  let guard: SseAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: {
    session: { findUnique: jest.Mock };
    user: { findFirst: jest.Mock };
  };

  const activeSession = {
    id: 'session-1',
    isDeleted: false,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };

  const adminUser = { id: 'admin-1', role: Role.admin, isDeleted: false };

  // Build an ExecutionContext carrying a query token; the returned request is
  // the same object the guard mutates, so tests can assert on request.user.
  function contextFor(token: unknown): {
    context: ExecutionContext;
    request: { query: { token: unknown }; user?: unknown };
  } {
    const request = { query: { token } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = {
      session: { findUnique: jest.fn() },
      user: { findFirst: jest.fn() },
    };
    guard = new SseAuthGuard(
      jwtService as unknown as JwtService,
      prisma as unknown as PrismaService,
    );
  });

  it('rejects a missing token', async () => {
    const { context } = contextFor(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a non-string token (e.g. duplicated query param)', async () => {
    const { context } = contextFor(['a', 'b']);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects an unverifiable token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const { context } = contextFor('bad.jwt');
    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Invalid token'),
    );
  });

  it('rejects a token with no authSessionId claim', async () => {
    jwtService.verifyAsync.mockResolvedValue({ userId: 'admin-1' });
    const { context } = contextFor('valid.jwt');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when the session no longer exists (revoked)', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      userId: 'admin-1',
      authSessionId: 'session-1',
    });
    prisma.session.findUnique.mockResolvedValue(null);
    const { context } = contextFor('valid.jwt');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a soft-deleted session', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      userId: 'admin-1',
      authSessionId: 'session-1',
    });
    prisma.session.findUnique.mockResolvedValue({
      ...activeSession,
      isDeleted: true,
    });
    const { context } = contextFor('valid.jwt');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      userId: 'admin-1',
      authSessionId: 'session-1',
    });
    prisma.session.findUnique.mockResolvedValue({
      ...activeSession,
      expiresAt: new Date(Date.now() - 1000),
    });
    const { context } = contextFor('valid.jwt');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller even when an admin exists elsewhere (scoping regression)', async () => {
    // The bug: the guard queried by a non-existent `sub` claim, so Prisma
    // dropped the id filter and returned the first admin — authorizing anyone.
    // Assert we query by the caller's own userId and honour their real role.
    jwtService.verifyAsync.mockResolvedValue({
      userId: 'parent-9',
      authSessionId: 'session-1',
    });
    prisma.session.findUnique.mockResolvedValue(activeSession);
    prisma.user.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id === 'parent-9'
          ? { id: 'parent-9', role: Role.parent, isDeleted: false }
          : adminUser,
      ),
    );
    const { context, request } = contextFor('valid.jwt');

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Admin access required'),
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'parent-9', isDeleted: false },
    });
    expect(request.user).toBeUndefined();
  });

  it('authorizes an admin with an active session and attaches the user', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      userId: 'admin-1',
      authSessionId: 'session-1',
    });
    prisma.session.findUnique.mockResolvedValue(activeSession);
    prisma.user.findFirst.mockResolvedValue(adminUser);
    const { context, request } = contextFor('valid.jwt');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'admin-1', isDeleted: false },
    });
    expect(request.user).toBe(adminUser);
  });
});
