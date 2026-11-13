import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ExpressAdapter } from '@bull-board/express';
import type { BullBoardModuleOptions } from '@bull-board/nestjs';

export const BULL_BOARD_ROUTE = '/admin/queues';

const digest = (value: string) => createHash('sha256').update(value).digest();

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

export function createBullBoardAuth(
  user: string | undefined,
  password: string | undefined,
) {
  const configured = Boolean(user?.trim() && password?.trim());

  return (req: Request, res: Response, next: NextFunction) => {
    if (!configured) {
      res.status(404).end();
      return;
    }
    const credentials = parseBasic(req.headers.authorization);
    const userOk = credentials ? safeEqual(credentials.user, user!) : false;
    const passwordOk = credentials
      ? safeEqual(credentials.password, password!)
      : false;
    if (!userOk || !passwordOk) {
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
  return {
    route: BULL_BOARD_ROUTE,
    adapter: ExpressAdapter,
    middleware: createBullBoardAuth(user, password),
  };
}
