import { AxiosError, type AxiosResponse } from 'axios';
import { metrics } from '@opentelemetry/api';
import type { HttpService } from '@nestjs/axios';
import { HttpLatencyInterceptor } from './http-latency.interceptor';

type Attributes = Record<string, string>;
type Recorded = { value: number; attributes: Attributes };

const counters = new Map<string, Recorded[]>();
const histograms = new Map<string, Recorded[]>();

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn(),
  },
}));

type SuccessHandler = (response: AxiosResponse) => AxiosResponse;
type ErrorHandler = (error: unknown) => Promise<never>;
type RequestHandler = <T>(config: T) => T;

/**
 * Captures the handlers the interceptor registers on the Axios instance so the
 * test can invoke them directly, rather than standing up a real HTTP server.
 */
const buildHarness = () => {
  counters.clear();
  histograms.clear();

  const record = (store: Map<string, Recorded[]>, name: string) => ({
    add: (value: number, attributes: Attributes) =>
      store.set(name, [...(store.get(name) ?? []), { value, attributes }]),
    record: (value: number, attributes: Attributes) =>
      store.set(name, [...(store.get(name) ?? []), { value, attributes }]),
  });

  (metrics.getMeter as jest.Mock).mockReturnValue({
    createCounter: (name: string) => record(counters, name),
    createHistogram: (name: string) => record(histograms, name),
  });

  const handlers: {
    request?: RequestHandler;
    success?: SuccessHandler;
    error?: ErrorHandler;
  } = {};

  const httpService = {
    axiosRef: {
      interceptors: {
        request: {
          use: (fn: RequestHandler) => {
            handlers.request = fn;
          },
        },
        response: {
          use: (onSuccess: SuccessHandler, onError: ErrorHandler) => {
            handlers.success = onSuccess;
            handlers.error = onError;
          },
        },
      },
    },
  } as unknown as HttpService;

  const interceptor = new HttpLatencyInterceptor(httpService);
  interceptor.onModuleInit();

  return { handlers, interceptor };
};

const attrsOf = (store: Map<string, Recorded[]>, name: string) =>
  (store.get(name) ?? []).map((r) => r.attributes);

describe('HttpLatencyInterceptor', () => {
  it('records host, method and status for a successful response', () => {
    const { handlers } = buildHarness();

    handlers.success?.({
      status: 204,
      config: { url: 'https://api.deepgram.com/v1/listen', method: 'post' },
    } as AxiosResponse);

    expect(attrsOf(counters, 'http_client_requests_total')).toEqual([
      { host: 'api.deepgram.com', method: 'POST', status: '204' },
    ]);
    expect(counters.get('http_client_request_errors_total')).toBeUndefined();
  });

  it('resolves the host from baseURL when the request url is relative', () => {
    const { handlers } = buildHarness();

    handlers.success?.({
      status: 200,
      config: { url: '/v1/tts', baseURL: 'https://api.elevenlabs.io' },
    } as AxiosResponse);

    expect(attrsOf(counters, 'http_client_requests_total')).toEqual([
      // No method on the config, so it falls back to GET.
      { host: 'api.elevenlabs.io', method: 'GET', status: '200' },
    ]);
  });

  it('records a duration only once the request side has stamped a start time', () => {
    const { handlers } = buildHarness();

    const bare = { url: 'https://example.com/a' };
    handlers.success?.({ status: 200, config: bare } as AxiosResponse);
    expect(
      histograms.get('http_client_request_duration_seconds'),
    ).toBeUndefined();

    const stamped = handlers.request?.({ url: 'https://example.com/a' });
    handlers.success?.({ status: 200, config: stamped } as AxiosResponse);
    expect(histograms.get('http_client_request_duration_seconds')).toHaveLength(
      1,
    );
  });

  it('records an Axios failure with its response status and increments the error counter', async () => {
    const { handlers } = buildHarness();

    const error = new AxiosError('Request failed', 'ERR_BAD_RESPONSE', {
      url: 'https://api.deepgram.com/v1/listen',
      method: 'post',
      headers: {},
    } as never);
    error.response = { status: 503 } as AxiosResponse;

    await expect(handlers.error?.(error)).rejects.toBe(error);

    expect(attrsOf(counters, 'http_client_request_errors_total')).toEqual([
      { host: 'api.deepgram.com', method: 'POST', status: '503' },
    ]);
  });

  it('records a network failure with no response as status 0', async () => {
    const { handlers } = buildHarness();

    const error = new AxiosError('socket hang up', 'ECONNRESET', {
      url: 'https://api.deepgram.com/v1/listen',
      method: 'get',
      headers: {},
    } as never);

    await expect(handlers.error?.(error)).rejects.toBe(error);

    expect(attrsOf(counters, 'http_client_request_errors_total')).toEqual([
      { host: 'api.deepgram.com', method: 'GET', status: '0' },
    ]);
  });

  it('records a non-Axios rejection as unknown host, status 0', async () => {
    const { handlers } = buildHarness();

    const error = new Error('an interceptor threw');

    await expect(handlers.error?.(error)).rejects.toBe(error);

    expect(attrsOf(counters, 'http_client_request_errors_total')).toEqual([
      { host: 'unknown', method: 'GET', status: '0' },
    ]);
  });

  it('wraps a non-Error rejection so downstream catch blocks get an Error', async () => {
    const { handlers } = buildHarness();

    await expect(handlers.error?.('just a string')).rejects.toThrow(
      'just a string',
    );
  });

  it('falls back to unknown host when the url cannot be parsed', () => {
    const { handlers } = buildHarness();

    handlers.success?.({
      status: 200,
      config: { url: 'http://[', method: 'get' },
    } as AxiosResponse);

    expect(attrsOf(counters, 'http_client_requests_total')).toEqual([
      { host: 'unknown', method: 'GET', status: '200' },
    ]);
  });
});
