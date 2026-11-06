describe('sentry-setup passwordless body protection', () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    process.env.SENTRY_DSN = originalDsn;
    jest.resetModules();
    jest.dontMock('@sentry/node');
  });

  it('stops Sentry attaching request bodies of /auth/passwordless/* routes', () => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/1';
    const httpIntegration = jest.fn().mockReturnValue({ name: 'Http' });
    const init = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init,
      httpIntegration,
      getClient: () => undefined,
      captureException: jest.fn(),
    }));
    jest.doMock('@sentry/opentelemetry', () => ({
      setupEventContextTrace: jest.fn(),
    }));

    jest.isolateModules(() => {
      require('./sentry-setup');
    });

    const opts = httpIntegration.mock.calls[0][0] as {
      ignoreIncomingRequestBody: (url: string) => boolean;
    };
    expect(
      opts.ignoreIncomingRequestBody('/api/v1/auth/passwordless/verify'),
    ).toBe(true);
    expect(opts.ignoreIncomingRequestBody('/auth/passwordless/consume')).toBe(
      true,
    );
    expect(opts.ignoreIncomingRequestBody('/api/v1/auth/login')).toBe(false);
    expect(init.mock.calls[0][0].integrations).toEqual([{ name: 'Http' }]);
  });
});
