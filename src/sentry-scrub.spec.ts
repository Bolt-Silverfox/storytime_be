/* eslint-disable @typescript-eslint/no-unsafe-argument */
import * as Sentry from '@sentry/node';
import {
  REDACTED,
  buildSentryOptions,
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

function scrubSentryEvent(event: any): any {
  return buildSentryOptions().beforeSend(event, {});
}

function scrubTransaction(event: any): any {
  return buildSentryOptions().beforeSendTransaction(
    { type: 'transaction', ...event },
    {},
  );
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
    expect(h['user-agent']).toBeUndefined();
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
    expect(e.request!.data).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain('a@b.c');
    expect(JSON.stringify(e)).not.toContain('hunter2');
  });

  it('drops string bodies and scrubs object/array query strings', () => {
    const ev: any = requestEvent();
    ev.request.data = JSON.stringify({ password: 'p', x: 1 });
    ev.request.query_string = [
      ['refresh_token', 'r'],
      ['a', 'b'],
    ];
    const e = scrubSentryEvent(ev);
    expect(e.request!.data).toBeUndefined();
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

  it('drops the user-agent header on error events and transactions', () => {
    const err = scrubSentryEvent(requestEvent());
    const tx = scrubTransaction(requestEvent());
    for (const h of [err.request.headers, tx.request.headers]) {
      expect(Object.keys(h).filter((k) => /user.?agent/i.test(k))).toEqual([]);
      expect(h['content-type']).toBe('application/json');
    }
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

describe('free-text credential scrubbing', () => {
  const messages = (text: string) => {
    const out = scrubSentryEvent({
      message: text,
      exception: { values: [{ value: text }] },
    });
    return [out.message, out.exception.values[0].value] as string[];
  };

  const LEAKS: Array<[string, string]> = [
    [
      'Invalid `prisma.user.create()` invocation: { data: { email: "SENT@x.io", name: "SENTNAME", passwordHash: "$2b$10$SENTHASH", pinHash: "SENTPIN" } }',
      'SENT',
    ],
    ['refreshToken: SENTSECRET', 'SENTSECRET'],
    ['clientSecret: "SENTSECRET"', 'SENTSECRET'],
    ['access_token SENTSECRET', 'SENTSECRET'],
    ["{'password': 'SENTSECRET'}", 'SENTSECRET'],
    ['pwd=SENTSECRET', 'SENTSECRET'],
    ['password= SENTSECRET', 'SENTSECRET'],
    ['password => SENTSECRET', 'SENTSECRET'],
    ['Password = "SENTSECRET"', 'SENTSECRET'],
    ['{"password":"SENTSECRET","ok":1}', 'SENTSECRET'],
    ['{"detail": "bad password: SENTSECRET"}', 'SENTSECRET'],
    ['login failed password: hunter2SENT, retry', 'hunter2SENT'],
    ['otp: 123456 rejected', '123456'],
    ['GET /cb?next=%2Fx%3Ftoken%3DSENTSECRET failed', 'SENTSECRET'],
    ['Authorization: Bearer SENTSECRET.abc.def', 'SENTSECRET'],
    ['api_key=SENTSECRET&page=2', 'SENTSECRET'],
  ];

  it.each(LEAKS)('redacts %s', (text, secret) => {
    for (const out of messages(text)) {
      expect(out).not.toContain(secret);
      expect(out).toContain(REDACTED);
    }
  });

  const HARMLESS = [
    'otp code mismatch',
    'Missing secret key',
    'token bucket empty',
    'pin attempts exceeded',
    'Error validating token payload',
    'access token: invalid_grant',
    'jwt expired',
    'Invalid OTP',
    'Refresh token not found',
    'name must be a string',
    'connect ECONNREFUSED 127.0.0.1:5432',
    'Request failed with status code 500',
    'GET https://api.example.com/stories?page=2&limit=10 failed',
    'Story 42 not found for user',
    'Unique constraint failed on the fields: (`id`)',
    'Cannot read properties of undefined (reading "length")',
    'Redis connection to localhost:6379 timed out',
  ];

  it.each(HARMLESS)('leaves %s unchanged', (text) => {
    for (const out of messages(text)) expect(out).toBe(text);
  });

  const ADVERSARIAL: Array<[string, string]> = [
    ['token plus 20k spaces then comma', `token${' '.repeat(19_994)},`],
    ['20k spaces', ' '.repeat(20_000)],
    ['repeated key words', 'token '.repeat(3_300)],
    ['repeated password colons', 'password: '.repeat(2_000)],
    ['long key-like run', 'a'.repeat(20_000)],
    ['long dotted run', 'a.'.repeat(10_000)],
    ['equals runs', '='.repeat(20_000)],
    ['quote runs', '"a'.repeat(10_000)],
  ];

  it.each(ADVERSARIAL)('scrubs %s in a few ms', (_name, text) => {
    const started = process.hrtime.bigint();
    messages(text);
    scrubSentryEvent({
      request: { headers: { 'x-custom': text }, url: text },
      message: text,
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(ms).toBeLessThan(100);
  });
});

describe('span and trace attribute scrubbing', () => {
  const OTEL_SAFE = {
    'db.name': 'storytime',
    'messaging.destination.name': 'audio',
    'bullmq.queue.name': 'tts',
    'job.name': 'render',
    'service.name': 'storytime-be',
    'host.name': 'api-1',
    'net.peer.name': 'db.internal',
    'code.function.name': 'run',
    'server.address': 'db.internal',
    storyId: 's1',
  };

  const OTEL_PRIVATE = {
    'client.address': '1.2.3.4',
    'http.client_ip': '1.2.3.4',
    'net.peer.ip': '1.2.3.4',
    'network.peer.address': '1.2.3.4',
    'user_agent.original': 'Mozilla',
    'http.request.header.x-real-ip': '1.2.3.4',
    kidId: 'k1',
    childId: 'c1',
    homeAddress: '1 Road',
  };

  it('keeps OTel service attributes and redacts client identity on spans, trace data and breadcrumbs', () => {
    const tx = scrubTransaction({
      contexts: {
        trace: {
          trace_id: 't',
          span_id: 's',
          data: { ...OTEL_SAFE, ...OTEL_PRIVATE },
        },
      },
      spans: [
        {
          span_id: 'a',
          trace_id: 't',
          data: { ...OTEL_SAFE, ...OTEL_PRIVATE },
        },
      ],
    });
    const crumb: any = scrubSentryBreadcrumb({
      data: { ...OTEL_SAFE, ...OTEL_PRIVATE },
    });
    for (const data of [tx.contexts.trace.data, tx.spans[0].data, crumb.data]) {
      for (const [k, v] of Object.entries(OTEL_SAFE)) expect(data[k]).toBe(v);
      for (const k of Object.keys(OTEL_PRIVATE)) expect(data[k]).toBe(REDACTED);
    }
  });
});
