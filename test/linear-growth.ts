const RUNS = 7;

function fastestRun(work: () => void): bigint {
  let best = BigInt(Number.MAX_SAFE_INTEGER);
  for (let i = 0; i < RUNS; i++) {
    const started = process.hrtime.bigint();
    work();
    const spent = process.hrtime.bigint() - started;
    if (spent < best) best = spent;
  }
  return best;
}

export function growthRatio<T>(
  run: (input: T) => void,
  makeInput: (n: number) => T,
  n: number,
  scale: number,
): number {
  const small = makeInput(n);
  const large = makeInput(n * scale);
  run(small);
  run(large);
  const smallNs = fastestRun(() => run(small));
  const largeNs = fastestRun(() => run(large));
  return Number(largeNs) / Number(smallNs > 0n ? smallNs : 1n);
}
