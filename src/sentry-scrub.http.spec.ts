import { spawnSync } from 'child_process';
import * as path from 'path';

// Mirrors the sentinel values generated in the runner (built at runtime so the
// literals never appear in stack-frame source context).
const SENTINELS = [
  'queryToken',
  'queryCode',
  'bodyPassword',
  'bearer',
  'cookie',
  'guest',
  'apikey',
  'errQuery',
  'outgoingToken',
].map((k) => `sentinel-${k.toLowerCase()}-${k.length}x`);

function spawnRunner(mode: 'scrub' | 'raw' | 'fail') {
  const root = path.resolve(__dirname, '..');
  return spawnSync(
    process.execPath,
    [
      '-r',
      'ts-node/register/transpile-only',
      path.join(root, 'test/sentry-scrub-http-runner.ts'),
      mode,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

function run(mode: 'scrub' | 'raw'): string {
  const r = spawnRunner(mode);
  expect(r.status).toBe(0);
  const m = /ENVELOPES_BEGIN([\s\S]*)ENVELOPES_END/.exec(r.stdout);
  expect(m).not.toBeNull();
  return m![1];
}

describe('real HTTP request, default integrations, tracing on (child process)', () => {
  it('sanity: without the scrubber the library leaks sentinels', () => {
    const out = run('raw');
    expect(out).toContain('hello from request');
    expect(SENTINELS.filter((s) => out.includes(s)).length).toBeGreaterThan(0);
  });

  it('with the scrubber no sentinel reaches the transport', () => {
    const out = run('scrub');
    expect(out).toContain('hello from request');
    expect(out).toContain('"type":"transaction"');
    expect(SENTINELS.filter((s) => out.includes(s))).toEqual([]);
  });

  it('exits non-zero and writes the error to stderr when the scenario rejects', () => {
    const r = spawnRunner('fail');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(
      'sentry-scrub-http-runner failed: Error: scenario failed on purpose',
    );
  });
});
