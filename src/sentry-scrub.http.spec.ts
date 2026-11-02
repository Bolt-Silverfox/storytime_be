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

function run(mode: 'scrub' | 'raw'): string {
  const root = path.resolve(__dirname, '..');
  const r = spawnSync(
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
});
