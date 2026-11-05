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
