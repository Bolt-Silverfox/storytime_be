import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { metrics, Counter, Histogram } from '@opentelemetry/api';
import { isAxiosError, type InternalAxiosRequestConfig } from 'axios';

/**
 * An Axios request config carrying the start-time stamp this interceptor adds
 * on the way out, so the response side can compute a duration.
 */
type TimedRequestConfig = InternalAxiosRequestConfig & {
  __startTime?: number;
};

/**
 * Axios-level interceptor that tracks outgoing HTTP request metrics
 * via OpenTelemetry.
 *
 * Metrics emitted:
 * - `http_client_requests_total`           (Counter)   – total outgoing requests
 * - `http_client_request_duration_seconds`  (Histogram) – request latency
 * - `http_client_request_errors_total`      (Counter)   – failed requests
 *
 * All metrics are labelled with { host, method, status }.
 *
 * Register this provider in every module that imports HttpModule so it
 * hooks into that module's Axios instance.
 */
@Injectable()
export class HttpLatencyInterceptor implements OnModuleInit {
  private readonly logger = new Logger(HttpLatencyInterceptor.name);
  private requestCounter!: Counter;
  private requestDurationHistogram!: Histogram;
  private requestErrorCounter!: Counter;

  constructor(private readonly httpService: HttpService) {}

  onModuleInit() {
    const meter = metrics.getMeter('http-client');

    this.requestCounter = meter.createCounter('http_client_requests_total', {
      description: 'Total number of outgoing HTTP requests',
    });

    this.requestDurationHistogram = meter.createHistogram(
      'http_client_request_duration_seconds',
      {
        description: 'Duration of outgoing HTTP requests in seconds',
        unit: 's',
      },
    );

    this.requestErrorCounter = meter.createCounter(
      'http_client_request_errors_total',
      {
        description: 'Total number of failed outgoing HTTP requests',
      },
    );

    this.setupInterceptors();
    this.logger.log('HTTP client latency interceptors initialized');
  }

  private setupInterceptors() {
    const axiosInstance = this.httpService.axiosRef;

    // Request interceptor — stamp start time
    axiosInstance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        (config as TimedRequestConfig).__startTime = Date.now();
        return config;
      },
    );

    // Response interceptor — record metrics on success and failure
    axiosInstance.interceptors.response.use(
      (response) => {
        this.recordMetrics(response.config, response.status);
        return response;
      },
      (error: unknown) => {
        // A non-Axios rejection (e.g. thrown by another interceptor) has no
        // config/response, so it is recorded with the same unknown-host,
        // status-0 defaults as before.
        const axiosError = isAxiosError(error) ? error : undefined;
        this.recordMetrics(
          axiosError?.config,
          axiosError?.response?.status ?? 0,
          true,
        );
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    );
  }

  private recordMetrics(
    config: TimedRequestConfig | undefined,
    status: number,
    isError = false,
  ) {
    const startTime = config?.__startTime;
    const host = this.extractHost(config);
    const method = (config?.method || 'GET').toUpperCase();

    const attributes = { host, method, status: String(status) };

    this.requestCounter.add(1, attributes);

    if (startTime) {
      const durationSeconds = (Date.now() - startTime) / 1000;
      this.requestDurationHistogram.record(durationSeconds, attributes);
    }

    if (isError) {
      this.requestErrorCounter.add(1, attributes);
    }
  }

  private extractHost(config: TimedRequestConfig | undefined): string {
    if (!config?.url) {
      return 'unknown';
    }

    try {
      // Handle both absolute URLs and relative URLs with a baseURL
      const url = new URL(config.url, config.baseURL || 'http://localhost');
      return url.hostname;
    } catch {
      return 'unknown';
    }
  }
}
