/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  REDACTED,
  buildSentryOptions,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from './sentry-scrub';

const dump = (v: unknown) => JSON.stringify(v);

describe('breadcrumbs (query kept separately from url)', () => {
  it('redacts http.query / url.query and keeps non-secret params', () => {
    const b: any = scrubSentryBreadcrumb({
      category: 'http',
      message: 'GET https://x.y/cb?code=SENT_MSG&a=1',
      data: {
        url: 'https://x.y/cb',
        'http.query': '?token=SENT_Q1&a=1',
        'url.query': 'refresh_token=SENT_Q2&b=2',
        method: 'GET',
        status_code: 200,
        'http.response.status_code': 200,
        note: 'see https://x.y/z?api_key=SENT_Q3&k=v',
      },
    });
    expect(dump(b)).not.toMatch(/SENT_/);
    expect(b.data['http.query']).toBe(`?token=${REDACTED}&a=1`);
    expect(b.data['url.query']).toBe(`refresh_token=${REDACTED}&b=2`);
    expect(b.data.status_code).toBe(200);
    expect(b.data['http.response.status_code']).toBe(200);
    expect(b.data.method).toBe('GET');
    expect(b.message).toContain('a=1');
  });

  it('beforeBreadcrumb hook scrubs (not identity)', () => {
    const out: any = buildSentryOptions().beforeBreadcrumb(
      { data: { 'http.query': 'token=SENT_H' } },
      {},
    );
    expect(dump(out)).not.toContain('SENT_H');
  });
});

describe('transactions', () => {
  it('scrubs trace data and span data, and http.request.header.*', () => {
    const tx: any = {
      type: 'transaction',
      transaction: 'GET /cb?code=SENT_T0',
      contexts: {
        trace: {
          trace_id: 'a'.repeat(32),
          data: {
            'url.full': 'http://h/cb?code=SENT_T1&x=1',
            'http.query': '?code=SENT_T2',
            'http.request.header.authorization': ['Bearer SENT_T3'],
            'http.request.header.cookie': 'sid=SENT_T4',
            'http.request.header.accept': 'a/b',
            'http.response.status_code': 200,
          },
        },
      },
      spans: [
        {
          description: 'GET http://h/x?token=SENT_T5',
          data: {
            'http.url': 'http://h/x?token=SENT_T6',
            'http.target': '/x?otp=SENT_T7',
            'url.query': 'pin=SENT_T8',
            'http.request.header.x-api-key': 'SENT_T9',
          },
        },
      ],
    };
    const out: any = buildSentryOptions().beforeSendTransaction(tx, {});
    expect(dump(out)).not.toMatch(/SENT_/);
    expect(out.contexts.trace.data['url.full']).toBe(
      `http://h/cb?code=${REDACTED}&x=1`,
    );
    expect(out.contexts.trace.data['http.request.header.accept']).toBe('a/b');
    expect(out.contexts.trace.data['http.response.status_code']).toBe(200);
    expect(out.contexts.trace.trace_id).toBe('a'.repeat(32));
  });
});

describe('request bodies', () => {
  it('redacts a truncated (invalid JSON) body', () => {
    const body = `{"password":"SENT_B1","pad":"${'a'.repeat(50)}...`;
    const e: any = scrubSentryEvent({ request: { data: body } } as any);
    expect(dump(e)).not.toContain('SENT_B1');
  });

  it('scrubs urlencoded bodies, including percent-encoded keys', () => {
    const e: any = scrubSentryEvent({
      request: { data: '%70assword=SENT_B2&a=1&refresh%5Ftoken=SENT_B3' },
    } as any);
    expect(dump(e)).not.toMatch(/SENT_/);
    expect(e.request.data).toContain('a=1');
  });

  it('redacts unparseable non-urlencoded text', () => {
    const e: any = scrubSentryEvent({
      request: { data: 'multipart\r\nname="pin"\r\n\r\nSENT_B4' },
    } as any);
    expect(dump(e)).not.toContain('SENT_B4');
  });
});

describe('key matching', () => {
  const sensitive = [
    'pin',
    'newPin',
    'otp',
    'resetOtp',
    'pin-reset-otp',
    'code',
    'pinCode',
    'cvv',
    'cvc',
    'card',
    'cardNumber',
    'pan',
    'sig',
    'signature',
    'reset',
    'nonce',
    'state',
    'jwt',
    'bearer',
    'private',
    'privateKey',
    'client_secret',
    'passwd',
    'credentials',
    'idToken',
    'x-api-key',
    'sessionId',
  ];
  it.each(sensitive)('redacts %s', (k) => {
    const e: any = scrubSentryEvent({
      request: { data: { [k]: 'SENT_K' } },
    } as any);
    expect(dump(e)).not.toContain('SENT_K');
  });

  const safe = [
    'email',
    'method',
    'status_code',
    'name',
    'spinner',
    'company',
    'expand',
    'description',
    'storyId',
    'page',
  ];
  it.each(safe)('keeps %s', (k) => {
    const e: any = scrubSentryEvent({
      request: { data: { [k]: 'keepme' } },
    } as any);
    expect(dump(e)).toContain('keepme');
  });
});

describe('depth, text and failure handling', () => {
  it('redacts instead of passing through past the depth limit', () => {
    let deep: any = { leaf: 'SENT_D' };
    for (let i = 0; i < 30; i++) deep = { n: deep };
    const e: any = scrubSentryEvent({ request: { data: deep } } as any);
    expect(dump(e)).not.toContain('SENT_D');
  });

  it('scrubs query params in exception values and messages', () => {
    const e: any = scrubSentryEvent({
      message: 'bad https://x/cb?code=SENT_E1',
      exception: {
        values: [{ type: 'Error', value: 'GET /cb?state=SENT_E2&ok=1 failed' }],
      },
    } as any);
    expect(dump(e)).not.toMatch(/SENT_/);
    expect(e.exception.values[0].value).toContain('ok=1');
  });

  it('never throws and never leaks when scrubbing fails (events)', () => {
    const ev: any = {
      message: 'failed token=SENT_F',
      transaction: 'GET /cb?token=SENT_F',
      exception: { values: [{ value: 'x token=SENT_F' }] },
      breadcrumbs: [{ data: { a: 'SENT_F' } }],
      contexts: { x: 'SENT_F' },
      request: {
        get headers() {
          throw new Error('boom');
        },
      },
    };
    let out: any;
    expect(() => {
      out = buildSentryOptions().beforeSend(ev, {});
    }).not.toThrow();
    expect(out.message).toBeUndefined();
    expect(out.request).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.contexts).toBeUndefined();
    expect(dump(out)).not.toContain('SENT_F');
    expect(out.transaction).toBeUndefined();
    expect(out.exception).toBeUndefined();
    const tx: any = {
      type: 'transaction',
      spans: [{ data: { x: 'SENT_F' } }],
      request: ev.request,
    };
    const t: any = buildSentryOptions().beforeSendTransaction(tx, {});
    expect(dump(t)).not.toContain('SENT_F');
  });

  it('fallback drops span description and data', () => {
    const t: any = scrubSentryEvent({
      type: 'transaction',
      spans: [
        {
          span_id: 's1',
          op: 'http.client',
          description: 'GET http://h/x?token=SENT_SPAN',
          data: { url: 'http://h/x?token=SENT_SPAN' },
        },
      ],
      request: {
        get headers() {
          throw new Error('boom');
        },
      },
    } as any);
    expect(dump(t)).not.toContain('SENT_SPAN');
    expect(t.spans[0].span_id).toBe('s1');
    expect(t.spans[0].op).toBe('http.client');
  });

  it('fallback is an allowlist: no credential survives in any other field', () => {
    const ev: any = {
      event_id: 'abc',
      level: 'error',
      release: 'r1',
      environment: 'prod',
      platform: 'node',
      message: 'SENT_ALL',
      logentry: { message: 'SENT_ALL', params: ['SENT_ALL'] },
      transaction: 'SENT_ALL',
      culprit: 'SENT_ALL',
      server_name: 'SENT_ALL',
      user: { id: 'SENT_ALL', email: 'SENT_ALL', ip_address: 'SENT_ALL' },
      tags: { a: 'SENT_ALL' },
      extra: { a: 'SENT_ALL' },
      fingerprint: ['SENT_ALL'],
      modules: { SENT_ALL: '1' },
      contexts: {
        trace: { trace_id: 't', span_id: 's', data: { a: 'SENT_ALL' } },
        other: { a: 'SENT_ALL' },
      },
      breadcrumbs: [{ message: 'SENT_ALL', data: { a: 'SENT_ALL' } }],
      exception: {
        values: [
          {
            value: 'SENT_ALL',
            stacktrace: { frames: [{ vars: { a: 'SENT_ALL' } }] },
          },
        ],
      },
      threads: { values: [{ name: 'SENT_ALL' }] },
      debug_meta: { images: [{ code_file: 'SENT_ALL' }] },
      sdk: { name: 'sentry.javascript.node', version: '1' },
      spans: [
        {
          span_id: 's1',
          description: 'SENT_ALL',
          data: { a: 'SENT_ALL' },
          tags: { a: 'SENT_ALL' },
          op: 'db',
          origin: 'auto',
          status: 'ok',
        },
      ],
      request: {
        url: 'SENT_ALL',
        get headers() {
          throw new Error('boom');
        },
      },
    };
    const out: any = scrubSentryEvent(ev);
    expect(dump(out)).not.toContain('SENT_ALL');
    expect(out.event_id).toBe('abc');
    expect(out.level).toBe('error');
    expect(out.release).toBe('r1');
    expect(out.environment).toBe('prod');
    expect(out.spans[0].op).toBe('db');
    expect(out.contexts.trace.trace_id).toBe('t');
  });

  it('drops a breadcrumb when scrubbing it fails', () => {
    const crumb: any = {
      get data() {
        throw new Error('boom');
      },
    };
    expect(buildSentryOptions().beforeBreadcrumb(crumb, {})).toBeNull();
  });
});

describe('review findings: nested and free-text credentials', () => {
  it.each([
    ['plain nested', 'continue=/cb?token=SENT_N1'],
    ['encoded nested', 'continue=%2Fcb%3Ftoken%3DSENT_N1'],
    ['double encoded nested', 'continue=%252Fcb%253Ftoken%253DSENT_N1'],
  ])('redacts %s secret in query_string and url', (_n, qs) => {
    const e: any = scrubSentryEvent({
      request: { query_string: qs, url: `https://x/login?${qs}&ok=1` },
    } as any);
    expect(dump(e)).not.toContain('SENT_N1');
    expect(e.request.url).toContain('ok=1');
  });

  it('keeps benign nested values', () => {
    const e: any = scrubSentryEvent({
      request: { query_string: 'continue=%2Fhome%3Fpage%3D2' },
    } as any);
    expect(dump(e)).toContain('%2Fhome%3Fpage%3D2');
  });

  it.each([
    'request failed: token=SENT_T1',
    'bad\ttoken=SENT_T1 and more',
    'Authorization: Bearer SENT_T1',
    'header authorization=Bearer SENT_T1',
  ])('scrubs free text %j', (msg) => {
    const e: any = scrubSentryEvent({
      message: msg,
      exception: { values: [{ value: msg }] },
    } as any);
    expect(dump(e)).not.toContain('SENT_T1');
  });

  it('keeps benign free-text pairs', () => {
    const e: any = scrubSentryEvent({ message: 'failed: ok=1' } as any);
    expect(e.message).toBe('failed: ok=1');
  });
});

describe('review round 2: credentials in free text', () => {
  it.each([
    ['json', '{"password":"SENT1","otp":"SENT2"}'],
    ['json spaced', 'body {"refreshToken" : "SENT1", "pin": 123456}'],
    ['colon', 'password: SENT1'],
    ['colon quoted', 'login failed, password: "SENT1 x"'],
    ['space', 'token SENT1'],
    ['otp space', 'invalid otp SENT1 supplied'],
  ])('redacts %s form in message and exception value', (_n, msg) => {
    const e: any = scrubSentryEvent({
      message: msg,
      exception: { values: [{ value: msg }] },
    } as any);
    expect(dump(e)).not.toContain('SENT1');
    expect(dump(e)).not.toContain('SENT2');
  });

  it.each([
    'token expired',
    'password is required',
    'Invalid token: expired',
    'the keyboard was pressed',
    'secret',
  ])('keeps harmless text %j', (msg) => {
    const e: any = scrubSentryEvent({ message: msg } as any);
    expect(e.message).toBe(msg);
  });
});

describe('review round 2: PII in requests', () => {
  it('beforeSend drops request.data entirely', () => {
    const out: any = buildSentryOptions().beforeSend(
      {
        request: {
          data: {
            email: 'SENT_E@x.io',
            phone: 'SENT_P',
            name: 'SENT_N',
            password: 'SENT_PW',
          },
        },
      } as any,
      {},
    );
    expect(dump(out)).not.toMatch(/SENT_/);
    expect(out.request.data).toBeUndefined();
  });

  it('beforeSend drops a string request.data', () => {
    const out: any = buildSentryOptions().beforeSend(
      { request: { data: '{"email":"SENT_E"}' } } as any,
      {},
    );
    expect(dump(out)).not.toContain('SENT_E');
  });

  it('redacts PII params in url, query_string and breadcrumb queries', () => {
    const qs = 'email=SENT_E%40x.io&phone=SENT_P&firstName=SENT_F&page=2';
    const e: any = scrubSentryEvent({
      request: {
        url: `https://x.y/users?${qs}`,
        query_string: qs,
      },
      breadcrumbs: [
        {
          category: 'http',
          data: { 'http.query': `?${qs}`, url: `https://x.y/u?${qs}` },
        },
      ],
    } as any);
    expect(dump(e)).not.toContain('SENT_');
    expect(e.request.url).toContain('page=2');
    expect(e.request.query_string).toContain('page=2');
  });

  it.each([
    'email',
    'phone',
    'phoneNumber',
    'name',
    'firstName',
    'last_name',
    'fullName',
    'dob',
    'dateOfBirth',
    'age',
    'ageRange',
    'kidName',
    'childName',
    'displayName',
    'avatarId',
  ])('redacts query param %s', (key) => {
    const e: any = scrubSentryEvent({
      request: { query_string: `${key}=SENT_V&page=2` },
    } as any);
    expect(dump(e)).not.toContain('SENT_V');
    expect(e.request.query_string).toContain('page=2');
  });

  it.each(['page', 'limit', 'sort', 'hostname', 'filename', 'language'])(
    'keeps harmless query param %s',
    (key) => {
      const e: any = scrubSentryEvent({
        request: { query_string: `${key}=ok` },
      } as any);
      expect(e.request.query_string).toBe(`${key}=ok`);
    },
  );
});

describe('review round 2: double failure', () => {
  const hostile = () =>
    new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        ownKeys() {
          throw new Error('boom');
        },
      },
    );

  it('beforeSend returns null so no envelope item is sent', () => {
    expect(buildSentryOptions().beforeSend(hostile() as any, {})).toBeNull();
  });

  it('beforeSendTransaction returns null so no envelope item is sent', () => {
    expect(
      buildSentryOptions().beforeSendTransaction(hostile() as any, {}),
    ).toBeNull();
  });
});

describe('review round 2: fallback sdk allowlist', () => {
  it('keeps sdk name and version only', () => {
    const out: any = scrubSentryEvent({
      sdk: {
        name: 'sentry.javascript.node',
        version: '1',
        integrations: ['SENT_SDK'],
        packages: [{ name: 'SENT_SDK', version: '1' }],
      },
      request: {
        get headers() {
          throw new Error('boom');
        },
      },
    } as any);
    expect(dump(out)).not.toContain('SENT_SDK');
    expect(out.sdk).toEqual({ name: 'sentry.javascript.node', version: '1' });
  });
});

describe('review round 2: end-user IP and user agent in transactions', () => {
  it('redacts client address, client ip, user agent and the header', () => {
    const tx: any = {
      type: 'transaction',
      request: {
        headers: {
          'user-agent': 'SENT_UA',
          'User-Agent': 'SENT_UA',
          accept: 'a/b',
        },
      },
      contexts: {
        trace: {
          trace_id: 't',
          data: {
            'client.address': '203.0.113.9',
            'http.client_ip': '203.0.113.9',
            'user_agent.original': 'SENT_UA',
            'http.user_agent': 'SENT_UA',
            'http.request.header.user-agent': 'SENT_UA',
            'http.response.status_code': 200,
          },
        },
      },
      spans: [{ data: { 'client.address': '203.0.113.9' } }],
    };
    const out: any = buildSentryOptions().beforeSendTransaction(tx, {});
    expect(dump(out)).not.toContain('203.0.113.9');
    expect(dump(out)).not.toContain('SENT_UA');
    expect(out.request.headers.accept).toBe('a/b');
    expect(out.contexts.trace.data['http.response.status_code']).toBe(200);
  });
});
