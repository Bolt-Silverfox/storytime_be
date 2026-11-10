type Reply = [null, unknown];

export class FakeRedisClient {
  readonly store = new Map<string, number>();
  readonly ttls = new Map<string, number>();

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

  del = (...keys: string[]) => {
    for (const key of keys) {
      this.store.delete(key);
      this.ttls.delete(key);
    }
    return Promise.resolve(keys.length);
  };
}
