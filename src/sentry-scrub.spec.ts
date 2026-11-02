import * as Sentry from '@sentry/node';
import {
  REDACTED,
  scrubSentryEvent,
  scrubSentryBreadcrumb,
} from './sentry-scrub';

const BEARER = 'Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig';

function requestEvent(): any {
  return {
    message: 'boom',
    request: {
      url: 'https://api.example.com/auth/login?token=abc&page=2',
      method: 'POST',
      headers: {
        Authorization: BEARER,
        COOKIE: 'sid=1; refresh=2',
        'Set-Cookie': ['a=1', 'b=2'],
        'X-Api-Key': 'k',
        'x-guest-session-id': 'g',
        'user-agent': 'jest',
        'content-type': 'application/json',
      },
      cookies: { sid: '1' },
      query_string: 'token=abc&page=2',
      data: {
        email: 'a@b.c',
        password: 'hunter2',
        nested: { refreshToken: 'r', list: [{ accessToken: 't', ok: 1 }] },
      },
    },
  };
}

describe('scrubSentryEvent', () => {
  it('redacts sensitive headers case-insensitively, keeps the rest', () => {
    const e = scrubSentryEvent(requestEvent());
    const h = e.request!.headers as Record<string, unknown>;
    expect(h.Authorization).toBe(REDACTED);
    expect(h.COOKIE).toBe(REDACTED);
    expect(h['Set-Cookie']).toBe(REDACTED);
    expect(h['X-Api-Key']).toBe(REDACTED);
    expect(h['x-guest-session-id']).toBe(REDACTED);
    expect(h['user-agent']).toBe('jest');
    expect(h['content-type']).toBe('application/json');
    expect(JSON.stringify(e)).not.toContain('eyJhbGci');
  });

  it('redacts cookies, body and query by key, keeps url/method', () => {
    const e = scrubSentryEvent(requestEvent());
    expect(e.request!.method).toBe('POST');
    expect(e.request!.cookies).toEqual({ sid: REDACTED });
    expect(e.request!.query_string).toBe(`token=${REDACTED}&page=2`);
    expect(e.request!.url).toBe(
      `https://api.example.com/auth/login?token=${REDACTED}&page=2`,
    );
    const d: any = e.request!.data;
    expect(d.email).toBe('a@b.c');
    expect(d.password).toBe(REDACTED);
    expect(d.nested.refreshToken).toBe(REDACTED);
    expect(d.nested.list[0]).toEqual({ accessToken: REDACTED, ok: 1 });
  });

  it('handles string bodies (JSON) and object/array query strings', () => {
    const ev: any = requestEvent();
    ev.request.data = JSON.stringify({ password: 'p', x: 1 });
    ev.request.query_string = [
      ['refresh_token', 'r'],
      ['a', 'b'],
    ];
    const e = scrubSentryEvent(ev);
    expect(JSON.parse(e.request!.data as string)).toEqual({
      password: REDACTED,
      x: 1,
    });
    expect(e.request!.query_string).toEqual([
      ['refresh_token', REDACTED],
      ['a', 'b'],
    ]);
  });

  it('scrubs breadcrumbs on the event and tolerates events without request', () => {
    const e = scrubSentryEvent({
      message: 'x',
      breadcrumbs: [
        {
          category: 'http',
          data: {
            url: 'https://x.y/z?api_key=1',
            headers: { authorization: BEARER },
            status_code: 500,
          },
        },
      ],
    } as any);
    const b: any = e.breadcrumbs![0];
    expect(b.data.url).toBe(`https://x.y/z?api_key=${REDACTED}`);
    expect(b.data.headers.authorization).toBe(REDACTED);
    expect(b.data.status_code).toBe(500);
    expect(scrubSentryEvent({ message: 'y' } as any)).toEqual({ message: 'y' });
  });

  it('scrubSentryBreadcrumb redacts data', () => {
    const b: any = scrubSentryBreadcrumb({
      data: { Cookie: 'a', method: 'GET' },
    });
    expect(b.data).toEqual({ Cookie: REDACTED, method: 'GET' });
  });

  it('survives cyclic data without throwing', () => {
    const ev: any = requestEvent();
    ev.request.data.self = ev.request.data;
    expect(() => scrubSentryEvent(ev)).not.toThrow();
  });
});

describe('end-to-end through Sentry.init with a fake transport', () => {
  afterEach(async () => {
    await Sentry.close();
  });

  async function run(capture: () => void, withTx = false) {
    const envelopes: string[] = [];
    const { buildSentryOptions } = await import('./sentry-scrub');
    Sentry.init({
      ...buildSentryOptions(),
      dsn: 'https://k@o0.ingest.invalid/1',
      tracesSampleRate: withTx ? 1 : 0,
      skipOpenTelemetrySetup: true,
      defaultIntegrations: false,
      integrations: [
        Sentry.requestDataIntegration({
          include: {
            cookies: true,
            headers: true,
            data: true,
            query_string: true,
            url: true,
          },
        }),
      ],
      transport: () => ({
        send: (env: unknown) => {
          envelopes.push(JSON.stringify(env));
          return Promise.resolve({});
        },
        flush: () => Promise.resolve(true),
      }),
    });
    capture();
    await Sentry.flush(2000);
    return envelopes.join('\n');
  }

  it('redacts auth headers on an exception captured in a request scope', async () => {
    const out = await run(() => {
      Sentry.withIsolationScope((scope) => {
        scope.setSDKProcessingMetadata({
          normalizedRequest: {
            url: 'https://api.example.com/x',
            method: 'GET',
            headers: {
              authorization: BEARER,
              cookie: 'sid=abc',
              accept: 'a/b',
            },
          },
        });
        Sentry.captureException(new Error('boom'));
      });
    });
    expect(out).toContain('boom');
    expect(out).toContain('api.example.com/x');
    expect(out).not.toContain('eyJhbGci');
    expect(out).not.toContain('sid=abc');
    expect(out).toContain(REDACTED);
  });

  it('redacts headers on transactions (beforeSendTransaction)', async () => {
    const { buildSentryOptions } = await import('./sentry-scrub');
    expect(typeof buildSentryOptions().beforeSendTransaction).toBe('function');
    const tx: any = { type: 'transaction', ...requestEvent() };
    const out = buildSentryOptions().beforeSendTransaction(
      tx as never,
      {},
    ) as any;
    expect(out.request.headers.Authorization).toBe(REDACTED);
  });

  it('sets sendDefaultPii false', async () => {
    const { buildSentryOptions } = await import('./sentry-scrub');
    expect(buildSentryOptions().sendDefaultPii).toBe(false);
  });
});
