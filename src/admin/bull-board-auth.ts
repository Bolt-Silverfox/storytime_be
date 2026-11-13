import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { ExpressAdapter } from '@bull-board/express';
import type { BullBoardModuleOptions } from '@bull-board/nestjs';

export const BULL_BOARD_ROUTE = '/admin/queues';
export const MIN_PASSWORD_LENGTH = 24;

const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_ADDRESSES = 1000;

const lengthEqualiserKey = randomBytes(32);

const digest = (value: string) =>
  createHmac('sha256', lengthEqualiserKey).update(value).digest();

const safeEqual = (a: string, b: string) =>
  timingSafeEqual(digest(a), digest(b));

function parseBasic(header: string | undefined) {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(header ?? '');
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return {
    user: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

interface FailureWindow {
  count: number;
  resetAt: number;
}

class FailureTracker {
  private readonly windows = new Map<string, FailureWindow>();

  retryAfterSeconds(address: string, now: number): number {
    const entry = this.windows.get(address);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= FAILURE_LIMIT
      ? Math.ceil((entry.resetAt - now) / 1000)
      : 0;
  }

  record(address: string, now: number): void {
    const entry = this.windows.get(address);
    if (entry && entry.resetAt > now) {
      entry.count += 1;
      return;
    }
    this.windows.delete(address);
    if (this.windows.size >= MAX_TRACKED_ADDRESSES) this.makeRoom(now);
    this.windows.set(address, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  }

  private makeRoom(now: number): void {
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) this.windows.delete(key);
    }
    if (this.windows.size < MAX_TRACKED_ADDRESSES) return;
    const oldest = this.windows.keys().next();
    if (!oldest.done) this.windows.delete(oldest.value);
  }
}

export function createBullBoardAuth(
  user: string | undefined,
  password: string | undefined,
) {
  const expectedUser = user?.trim() ?? '';
  const expectedPassword = password?.trim() ?? '';
  const configured =
    expectedUser.length > 0 && expectedPassword.length >= MIN_PASSWORD_LENGTH;
  const failures = new FailureTracker();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!configured) {
      res.status(404).end();
      return;
    }
    const address = req.ip ?? 'unknown';
    const retryAfter = failures.retryAfterSeconds(address, Date.now());
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      res.status(429).end();
      return;
    }
    const credentials = parseBasic(req.headers.authorization);
    const userOk = credentials
      ? safeEqual(credentials.user, expectedUser)
      : false;
    const passwordOk = credentials
      ? safeEqual(credentials.password, expectedPassword)
      : false;
    if (!userOk || !passwordOk) {
      if (credentials) failures.record(address, Date.now());
      res.set('WWW-Authenticate', 'Basic realm="Queues", charset="UTF-8"');
      res.status(401).end();
      return;
    }
    next();
  };
}

export function bullBoardRootOptions(
  user: string | undefined,
  password: string | undefined,
): BullBoardModuleOptions {
  const configuredPassword = password?.trim() ?? '';
  if (
    configuredPassword.length > 0 &&
    configuredPassword.length < MIN_PASSWORD_LENGTH
  ) {
    new Logger('BullBoard').warn(
      `BULL_BOARD_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters; the queue dashboard is disabled`,
    );
  }
  return {
    route: BULL_BOARD_ROUTE,
    adapter: ExpressAdapter,
    middleware: createBullBoardAuth(user, password),
  };
}

export const bullBoardOptionsFromConfig = (config: {
  get<T>(key: string): T | undefined;
}) =>
  bullBoardRootOptions(
    config.get<string>('BULL_BOARD_USER'),
    config.get<string>('BULL_BOARD_PASSWORD'),
  );
