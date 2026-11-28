import { COUNT_MISS, READ_MISSES } from '@/auth/services/reset-attempt-counter';

export type FakeReply = 'ok' | 'down' | 'garbage' | 'slow' | 'late';

export const FAKE_LATE_DELIVERY_MS = 3000;

export class FakeRedisClient {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  readonly applied: string[] = [];
  online = true;
  readReply: FakeReply = 'ok';
  chargeReply: FakeReply = 'ok';
  writeReply: FakeReply = 'ok';
  private readonly deadlines = new Map<string, number>();
  private offlineQueue: Array<() => void> = [];

  get status() {
    return this.online ? 'ready' : 'reconnecting';
  }

  seed(key: string, misses: number, ttlMs: number | null = 3_600_000) {
    this.forget(key);
    this.values.set(key, String(misses));
    if (ttlMs !== null) this.expire(key, ttlMs);
  }

  reset() {
    this.values.clear();
    this.ttls.clear();
    this.deadlines.clear();
    this.applied.length = 0;
  }

  failures(key: string): number | undefined {
    this.evictIfExpired(key);
    const stored = this.values.get(key);
    return stored === undefined ? undefined : Number(stored);
  }

  counts(): number[] {
    return [...this.values.keys()].map((key) => this.failures(key)!);
  }

  disconnect() {
    this.online = false;
  }

  reconnect() {
    this.online = true;
    const queued = this.offlineQueue;
    this.offlineQueue = [];
    queued.forEach((command) => command());
  }

  eval = (
    script: string,
    numKeys: number,
    key: string,
    windowMs: string,
  ): Promise<unknown> => {
    if (numKeys !== 1) {
      return Promise.reject(new Error('ERR wrong number of keys'));
    }
    const heal = () => {
      if (!this.deadlines.has(key)) this.expire(key, Number(windowMs));
    };
    if (script === READ_MISSES) {
      return this.send(
        'read',
        this.readReply,
        () => {
          this.evictIfExpired(key);
          const stored = this.values.get(key) ?? null;
          if (stored !== null) heal();
          return stored;
        },
        () => 'not-a-count',
      );
    }
    if (script === COUNT_MISS) {
      return this.send(
        'charge',
        this.chargeReply,
        () => {
          this.evictIfExpired(key);
          const misses = Number(this.values.get(key) ?? 0) + 1;
          this.values.set(key, String(misses));
          heal();
          return misses;
        },
        () => null,
      );
    }
    return Promise.reject(new Error('NOSCRIPT unexpected script'));
  };

  del = (...keys: string[]): Promise<number> =>
    this.send(
      'del',
      this.writeReply,
      () => {
        let removed = 0;
        for (const key of keys) {
          if (this.values.has(key)) removed++;
          this.forget(key);
        }
        return removed;
      },
      () => 0,
    );

  private forget(key: string) {
    this.values.delete(key);
    this.ttls.delete(key);
    this.deadlines.delete(key);
  }

  private expire(key: string, ttlMs: number) {
    this.ttls.set(key, ttlMs);
    this.deadlines.set(key, Date.now() + ttlMs);
  }

  private evictIfExpired(key: string) {
    const deadline = this.deadlines.get(key);
    if (deadline !== undefined && Date.now() >= deadline) this.forget(key);
  }

  private send<T>(
    name: string,
    reply: FakeReply,
    apply: () => T,
    garbage: () => T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        switch (reply) {
          case 'down':
            return reject(new Error('Connection is closed.'));
          case 'slow':
            return undefined;
          case 'garbage':
            return resolve(garbage());
          case 'late':
            setTimeout(() => {
              this.applied.push(name);
              resolve(apply());
            }, FAKE_LATE_DELIVERY_MS);
            return undefined;
          default:
            this.applied.push(name);
            return resolve(apply());
        }
      };
      if (this.online) setImmediate(run);
      else this.offlineQueue.push(run);
    });
  }
}
