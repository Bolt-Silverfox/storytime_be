import { spawnSync } from 'child_process';
import * as path from 'path';
import { S, SENTINELS } from '../test/sentry-scrub-sentinels';

const NOT_CAPTURED_WITHOUT_SCRUBBER = [S.bodyPassword];

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
    const expectedLeaks = SENTINELS.filter(
      (s) => !NOT_CAPTURED_WITHOUT_SCRUBBER.includes(s),
    );
    expect(expectedLeaks.filter((s) => !out.includes(s))).toEqual([]);
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
