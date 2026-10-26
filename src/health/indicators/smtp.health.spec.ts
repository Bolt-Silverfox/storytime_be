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
});
