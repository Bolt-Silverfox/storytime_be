interface ClosableRedis {
  quit(): Promise<unknown>;
  disconnect(): void;
}

export const withinDeadline = <T>(
  work: Promise<T>,
  what: string,
  deadlineMs = 2_000,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`Redis ${what} did not reply within ${deadlineMs}ms`)),
      deadlineMs,
    );
  });
  return Promise.race([work, stalled]).finally(() => clearTimeout(timer));
};

export async function closeRedisAfter(
  client: ClosableRedis,
  cleanup: () => Promise<unknown>,
  deadlineMs = 2_000,
): Promise<void> {
  try {
    await withinDeadline(cleanup(), 'cleanup', deadlineMs);
  } finally {
    await withinDeadline(
      Promise.resolve().then(() => client.quit()),
      'quit',
      deadlineMs,
    ).catch(() => undefined);
    client.disconnect();
  }
}
