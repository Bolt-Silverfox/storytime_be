import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SmtpHealthIndicator } from './smtp.health';

jest.mock('nodemailer');

describe('SmtpHealthIndicator', () => {
  const config = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: 2525,
    SMTP_SECURE: false,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
  } as Record<string, unknown>;
  const indicator = new SmtpHealthIndicator(new HealthIndicatorService(), {
    get: (k: string) => config[k],
  } as unknown as ConfigService<never, true>);
  const verify = jest.fn();
  const close = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      verify,
      close,
    });
  });

  it('reports up with host, port and verified connection', async () => {
    verify.mockResolvedValue(true);

    expect(await indicator.isHealthy('smtp')).toEqual({
      smtp: {
        status: 'up',
        duration: expect.stringMatching(/^\d+ms$/),
        host: 'smtp.example.test',
        port: 2525,
        connection: 'verified',
      },
    });
    expect(close).toHaveBeenCalled();
  });

  it('reports down with host and error when verification fails', async () => {
    verify.mockRejectedValue(new Error('connect ETIMEDOUT'));

    expect(await indicator.isHealthy('smtp')).toEqual({
      smtp: {
        status: 'down',
        duration: expect.stringMatching(/^\d+ms$/),
        host: 'smtp.example.test',
        error: 'connect ETIMEDOUT',
      },
    });
  });

  describe('cachedHealth', () => {
    const fresh = () =>
      new SmtpHealthIndicator(new HealthIndicatorService(), {
        get: (k: string) => config[k],
      } as unknown as ConfigService<never, true>);

    it('is not reported up before any result exists, and opens no connection', () => {
      expect(fresh().cachedHealth('smtp').smtp.status).toBe('down');
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('serves the last live result with no host, port or error text', async () => {
      verify.mockRejectedValue(new Error('connect ETIMEDOUT'));
      await indicator.isHealthy('smtp');
      jest.clearAllMocks();

      expect(indicator.cachedHealth('smtp')).toEqual({
        smtp: { status: 'down' },
      });
      expect(nodemailer.createTransport).not.toHaveBeenCalled();

      verify.mockResolvedValue(true);
      await indicator.isHealthy('smtp');

      expect(indicator.cachedHealth('smtp')).toEqual({
        smtp: { status: 'up' },
      });
    });
  });

  describe('background refresh', () => {
    const FIVE_MIN = 5 * 60 * 1000;
    let bg: SmtpHealthIndicator;

    beforeEach(() => {
      jest.useFakeTimers();
      bg = new SmtpHealthIndicator(new HealthIndicatorService(), {
        get: (k: string) => config[k],
      } as unknown as ConfigService<never, true>);
    });

    afterEach(() => {
      bg.onModuleDestroy();
      jest.useRealTimers();
    });

    it('populates the cache at init without any admin request', async () => {
      verify.mockResolvedValue(true);

      bg.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);

      expect(bg.cachedHealth('smtp').smtp.status).toBe('up');
    });

    it('does not report up when SMTP is broken at boot', async () => {
      verify.mockRejectedValue(new Error('535 bad credentials'));

      bg.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);

      expect(bg.cachedHealth('smtp')).toEqual({ smtp: { status: 'down' } });
    });

    it('re-checks every five minutes while healthy', async () => {
      verify.mockResolvedValue(true);
      bg.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(verify).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(FIVE_MIN);
      expect(verify).toHaveBeenCalledTimes(2);
    });

    it('backs off after failures, capped at five minutes', async () => {
      verify.mockRejectedValue(new Error('down'));
      bg.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(verify).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(29_000);
      expect(verify).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(verify).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(59_000);
      expect(verify).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(verify).toHaveBeenCalledTimes(3);

      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(FIVE_MIN);
      }
      const calls = verify.mock.calls.length;
      await jest.advanceTimersByTimeAsync(FIVE_MIN);
      expect(verify.mock.calls.length).toBe(calls + 1);
    });

    it('runs one probe at a time', async () => {
      let release: (v: boolean) => void = () => undefined;
      verify.mockImplementation(
        () => new Promise<boolean>((resolve) => (release = resolve)),
      );

      bg.onModuleInit();
      const adminCall = bg.isHealthy('smtp');
      await jest.advanceTimersByTimeAsync(0);

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);

      release(true);
      await adminCall;
      expect(bg.cachedHealth('smtp').smtp.status).toBe('up');
    });

    it('stops scheduling on destroy', async () => {
      verify.mockResolvedValue(true);
      bg.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);

      bg.onModuleDestroy();

      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(FIVE_MIN * 2);
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it('does not reschedule when destroyed during a probe', async () => {
      let release: (v: boolean) => void = () => undefined;
      verify.mockImplementation(
        () => new Promise<boolean>((resolve) => (release = resolve)),
      );
      bg.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);

      bg.onModuleDestroy();
      release(true);
      await jest.advanceTimersByTimeAsync(0);

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
