import { CHARGE_WITHIN_LIMIT } from '@/auth/services/reset-attempt-counter';

export type FakeLink = 'up' | 'late' | 'offline';
export type FakeReply = 'ok' | 'down' | 'garbage' | 'slow';

export const FAKE_LATE_DELIVERY_MS = 3000;

type Reply = [null, unknown];

export class FakeRedisClient {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly store = new Map<string, number>();
  readonly ttls = new Map<string, number>();
  readonly applied: string[] = [];
  link: FakeLink = 'up';
  chargeReply: FakeReply = 'ok';
  writeReply: FakeReply = 'ok';
  private readonly deadlines = new Map<string, number>();
  private backlog: Array<() => void> = [];
  private lateTimer: NodeJS.Timeout | undefined;

  get status() {
    return this.link === 'offline' ? 'reconnecting' : 'ready';
  }

  seed(key: string, failures: number, ttlMs: number | null = 3_600_000) {
    const hash = new Map([['window', '1']]);
    for (let i = 0; i < failures; i++) hash.set(`seed-${i}`, '1');
    this.forget(key);
    this.hashes.set(key, hash);
    if (ttlMs !== null) this.expireIn(key, ttlMs);
  }

  reset() {
    this.hashes.clear();
    this.store.clear();
    this.ttls.clear();
    this.deadlines.clear();
    this.applied.length = 0;
  }

  private forget(key: string) {
    this.hashes.delete(key);
    this.ttls.delete(key);
    this.deadlines.delete(key);
  }

  private expireIn(key: string, ttlMs: number) {
    this.ttls.set(key, ttlMs);
    this.deadlines.set(key, Date.now() + ttlMs);
  }

  private evictIfExpired(key: string) {
    const deadline = this.deadlines.get(key);
    if (deadline !== undefined && Date.now() >= deadline) this.forget(key);
  }

  failures(key: string): number | undefined {
    const hash = this.hashes.get(key);
    return hash ? hash.size - 1 : undefined;
  }

  counts(): number[] {
    return [...this.hashes.keys()].map((key) => this.failures(key)!);
  }

  reconnect() {
    this.link = 'up';
    this.drain();
  }

  multi = () => {
    const ops: Array<() => unknown> = [];
    const chain = {
      set: (
        key: string,
        _value: number,
        _mode: 'EX',
        ttl: number,
        nx?: 'NX',
      ) => {
        ops.push(() => {
          if (nx === 'NX' && this.store.has(key)) return null;
          this.store.set(key, 0);
          this.ttls.set(key, ttl);
          return 'OK';
        });
        return chain;
      },
      incr: (key: string) => {
        ops.push(() => {
          const next = (this.store.get(key) ?? 0) + 1;
          this.store.set(key, next);
          return next;
        });
        return chain;
      },
      ttl: (key: string) => {
        ops.push(() => this.ttls.get(key) ?? -1);
        return chain;
      },
      exec: () => Promise.resolve(ops.map((op): Reply => [null, op()])),
    };
    return chain;
  };

  expire = (key: string, ttl: number) => {
    this.ttls.set(key, ttl);
    return Promise.resolve(1);
  };

  eval = (
    script: string,
    numKeys: number,
    key: string,
    windowMs: string,
    max: string,
    windowField: string,
    reservation: string,
  ): Promise<unknown> => {
    if (script !== CHARGE_WITHIN_LIMIT || numKeys !== 1) {
      return Promise.reject(new Error('NOSCRIPT unexpected script'));
    }
    return this.send(
      'eval',
      this.chargeReply,
      () => {
        this.evictIfExpired(key);
        const hash = this.hashes.get(key) ?? new Map<string, string>();
        this.hashes.set(key, hash);
        if (!hash.has(windowField)) hash.set(windowField, '1');
        if (!this.ttls.has(key)) this.expireIn(key, Number(windowMs));
        const charged = hash.size - 1;
        if (charged >= Number(max)) return 0;
        hash.set(reservation, '1');
        return charged + 1;
      },
      () => null,
    );
  };

  hdel = (key: string, field: string): Promise<number> =>
    this.send(
      'hdel',
      this.writeReply,
      () => {
        this.evictIfExpired(key);
        const removed = this.hashes.get(key)?.delete(field) ? 1 : 0;
        if (this.hashes.get(key)?.size === 0) this.forget(key);
        return removed;
      },
      () => 0,
    );

  del = (...keys: string[]): Promise<number> =>
    this.send(
      'del',
      this.writeReply,
      () => {
        let removed = 0;
        for (const key of keys) {
          if (this.hashes.has(key) || this.store.has(key)) removed++;
          this.store.delete(key);
          this.forget(key);
        }
        return removed;
      },
      () => 0,
    );

  private send<T>(
    name: string,
    reply: FakeReply,
    apply: () => T,
    garbage: () => T,
  ): Promise<T> {
    const run = (resolve: (value: T) => void, reject: (e: Error) => void) => {
      switch (reply) {
        case 'down':
          return reject(new Error('Connection is closed.'));
        case 'slow':
          return undefined;
        case 'garbage':
          return resolve(garbage());
        default:
          this.applied.push(name);
          return resolve(apply());
      }
    };
    return new Promise<T>((resolve, reject) => {
      if (this.link === 'up' && this.backlog.length === 0) {
        setImmediate(() => run(resolve, reject));
        return;
      }
      this.backlog.push(() => run(resolve, reject));
      if (this.link === 'late' && !this.lateTimer) {
        this.lateTimer = setTimeout(() => {
          this.lateTimer = undefined;
          this.drain();
        }, FAKE_LATE_DELIVERY_MS);
      }
    });
  }

  private drain() {
    const queued = this.backlog;
    this.backlog = [];
    queued.forEach((command) => command());
  }
}
