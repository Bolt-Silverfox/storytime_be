/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  REDACTED,
  buildSentryOptions,
  scrubSentryBreadcrumb,
} from './sentry-scrub';

const PW = 'SENT_UIPASS';
const USER = 'SENT_UIUSER';

const scrubError = (event: any): any =>
  buildSentryOptions().beforeSend(event, {});

const scrubTx = (event: any): any =>
  buildSentryOptions().beforeSendTransaction(
    { type: 'transaction', ...event },
    {},
  );

const scrubMessage = (text: string): string =>
  scrubError({ message: text }).message;

const CARRIERS: Array<[string, string, string]> = [
  [
    'postgres url',
    `postgresql://${USER}:${PW}@db.internal:5432/app`,
    `postgresql://${REDACTED}@db.internal:5432/app`,
  ],
  [
    'redis url with empty user',
    `redis://:${PW}@cache:6379/0`,
    `redis://${REDACTED}@cache:6379/0`,
  ],
  [
    'amqps url with scheme plus',
    `amqp+ssl://${USER}:${PW}@mq/vhost`,
    `amqp+ssl://${REDACTED}@mq/vhost`,
  ],
  [
    'upper-case scheme',
    `POSTGRES://${USER}:${PW}@db/app`,
    `POSTGRES://${REDACTED}@db/app`,
  ],
  [
    'password containing a raw at-sign',
    `smtp://${USER}:${PW}@x@mail:587`,
    `smtp://${REDACTED}@mail:587`,
  ],
  [
    'password with percent-encoded at-sign',
    `postgres://${USER}:${PW}%40x@db/app`,
    `postgres://${REDACTED}@db/app`,
  ],
  [
    'fully percent-encoded url',
    `postgres%3A%2F%2F${USER}%3A${PW}%40db%2Fapp`,
    `postgres%3A%2F%2F${REDACTED}%40db%2Fapp`,
  ],
  [
    'url with query and fragment',
    `https://${USER}:${PW}@h/p?a=1#frag`,
    `https://${REDACTED}@h/p?a=1#frag`,
  ],
];

describe('URL userinfo credentials in free text', () => {
  it.each(CARRIERS)('redacts %s', (_name, input, expected) => {
    expect(scrubMessage(input)).toBe(expected);
    expect(scrubMessage(`connect failed: ${input} (retrying), see log`)).toBe(
      `connect failed: ${expected} (retrying), see log`,
    );
  });

  it('redacts two urls in one string independently', () => {
    expect(
      scrubMessage(`a=redis://u:${PW}@h1/0 b=postgres://v:${PW}@h2/1`),
    ).toBe(`a=redis://${REDACTED}@h1/0 b=postgres://${REDACTED}@h2/1`);
  });

  it.each([
    'https://example.com/path/a@b.c',
    'https://example.com/cb?contact=a@b.c',
    'https://example.com#frag@x',
    'postgresql://db.internal:5432/app',
    'mailto:someone@example.com',
    'user:pass@host',
  ])('leaves %s unchanged', (text) => {
    expect(scrubMessage(text)).toBe(text);
  });

  it('redacts a url passed as a query-string parameter value', () => {
    const out = scrubError({
      request: {
        url: 'https://api/x',
        query_string: `dsn=postgres://${USER}:${PW}@db/app&page=2`,
      },
    });
    expect(JSON.stringify(out)).not.toContain(PW);
    expect(out.request.query_string).toContain('page=2');
  });
});

describe('connection string in every event field', () => {
  const URL_WITH_SECRET = `redis://${USER}:${PW}@cache:6379`;

  const fullEvent = (): any => ({
    message: `m ${URL_WITH_SECRET}`,
    transaction: `t ${URL_WITH_SECRET}`,
    exception: { values: [{ type: 'Error', value: `e ${URL_WITH_SECRET}` }] },
    extra: { dsn: URL_WITH_SECRET, nested: [{ u: URL_WITH_SECRET }] },
    breadcrumbs: [
      { message: `b ${URL_WITH_SECRET}`, data: { target: URL_WITH_SECRET } },
    ],
    contexts: {
      trace: {
        trace_id: 't',
        span_id: 's',
        data: {
          'db.connection_string': URL_WITH_SECRET,
          other: URL_WITH_SECRET,
        },
      },
    },
    spans: [
      {
        span_id: 'a',
        trace_id: 't',
        description: `connect ${URL_WITH_SECRET}`,
        data: { 'db.url': URL_WITH_SECRET, other: URL_WITH_SECRET },
      },
    ],
    request: { url: URL_WITH_SECRET, method: 'GET' },
  });

  it('is gone from errors, transactions and breadcrumbs on the normal path', () => {
    for (const out of [scrubError(fullEvent()), scrubTx(fullEvent())]) {
      const dumped = JSON.stringify(out);
      expect(dumped).not.toContain(PW);
      expect(dumped).not.toContain(USER);
      expect(dumped).toContain(`redis://${REDACTED}@cache:6379`);
    }
    const crumb: any = scrubSentryBreadcrumb(fullEvent().breadcrumbs[0]);
    expect(JSON.stringify(crumb)).not.toContain(PW);
  });

  it('is gone on the fail-closed fallback path', () => {
    const throwing = (): any => ({
      ...fullEvent(),
      request: {
        url: URL_WITH_SECRET,
        get headers() {
          throw new Error('boom');
        },
      },
    });
    for (const out of [scrubError(throwing()), scrubTx(throwing())]) {
      const dumped = JSON.stringify(out);
      expect(dumped).not.toContain(PW);
      expect(dumped).not.toContain(USER);
    }
  });
});

describe('userinfo scrubbing stays linear', () => {
  const INPUTS: Array<[string, string]> = [
    ['scheme-like run without separator', 'a.'.repeat(9_990)],
    ['alnum run', 'a'.repeat(19_990)],
    ['repeated scheme separators', 'a://'.repeat(4_990)],
    ['repeated encoded separators', 'a%3A%2F%2F'.repeat(1_990)],
    ['one long userinfo without at-sign', `x://${'u:'.repeat(9_990)}`],
    ['one long userinfo ending in at-sign', `x://${'u:'.repeat(9_990)}@h`],
    ['many at-signs in one userinfo', `x://${'@'.repeat(19_990)}`],
    ['many urls, each without at-sign', 'x://u:p '.repeat(2_490)],
    ['many urls, each with at-sign', 'x://u:p@h '.repeat(1_990)],
    ['encoded at-signs', `x://${'%40'.repeat(6_660)}`],
  ];

  it.each(INPUTS)('%s', (_name, text) => {
    scrubMessage('warm://up:pw@h');
    const started = process.hrtime.bigint();
    scrubMessage(text);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(ms).toBeLessThan(2000);
  });
});
