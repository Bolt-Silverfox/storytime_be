import { getPrometheusHost } from './otel-prometheus-host';

describe('getPrometheusHost', () => {
  it('binds to loopback by default', () => {
    expect(getPrometheusHost({})).toBe('127.0.0.1');
  });

  it('treats a blank override as unset', () => {
    expect(getPrometheusHost({ OTEL_EXPORTER_PROMETHEUS_HOST: '  ' })).toBe(
      '127.0.0.1',
    );
  });

  it('honours OTEL_EXPORTER_PROMETHEUS_HOST', () => {
    expect(
      getPrometheusHost({ OTEL_EXPORTER_PROMETHEUS_HOST: '0.0.0.0' }),
    ).toBe('0.0.0.0');
  });
});
