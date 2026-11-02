/**
 * Child-process driver for src/sentry-scrub.http.spec.ts. Runs in its own
 * process because Sentry's default integrations patch http and install global
 * handlers, which must not leak into the shared jest worker.
 * Usage: node -r ts-node/register/transpile-only test/sentry-scrub-http-runner.ts <scrub|raw>
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as Sentry from '@sentry/node';
import { buildSentryOptions } from '../src/sentry-scrub';

// Built at runtime so the literals never appear in source context lines that
// Sentry attaches to stack frames.
export const S = Object.fromEntries(
  [
    'queryToken',
    'queryCode',
    'bodyPassword',
    'bearer',
    'cookie',
    'guest',
    'apikey',
    'errQuery',
    'outgoingToken',
  ].map((k) => [k, `sentinel-${k.toLowerCase()}-${k.length}x`]),
) as Record<string, string>;
export const SENTINELS = Object.values(S);

function call(
  port: number,
  path: string,
  headers: http.OutgoingHttpHeaders,
  body?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function runScenario(scrub: boolean): Promise<string> {
  const envelopes: string[] = [];
  Sentry.init({
    ...(scrub ? buildSentryOptions() : {}),
    dsn: 'https://k@o0.ingest.invalid/1',
    tracesSampleRate: 1,
    transport: () => ({
      send: (env: unknown) => {
        envelopes.push(JSON.stringify(env));
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
  });
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/inner')) {
      res.end('ok');
      return;
    }
    req.resume();
    req.on('end', () => {
      Sentry.captureException(
        new Error(`failed /cb?code=${S.errQuery}&ok=1 ${req.url}`),
      );
      Sentry.captureMessage('hello from request');
      const port = (server.address() as AddressInfo).port;
      void call(port, `/inner?token=${S.outgoingToken}&x=1`, {}).then(() =>
        res.end('done'),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const body = JSON.stringify({
    password: S.bodyPassword,
    pad: 'a'.repeat(20 * 1024),
  });
  await call(
    port,
    `/story?token=${S.queryToken}&code=${S.queryCode}&page=2`,
    {
      authorization: `Bearer ${S.bearer}`,
      cookie: `sid=${S.cookie}`,
      'x-guest-session-id': S.guest,
      'x-api-key': S.apikey,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  );
  await Sentry.flush(3000);
  await new Promise((r) => server.close(r));
  await Sentry.close();
  return envelopes.join('\n');
}

void runScenario(process.argv[2] === 'scrub').then((out) => {
  process.stdout.write(`ENVELOPES_BEGIN${out}ENVELOPES_END`, () =>
    process.exit(0),
  );
});
