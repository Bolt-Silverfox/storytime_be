import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import type { v2 as CloudinaryType } from 'cloudinary';
import { CloudinaryHealthIndicator } from './cloudinary.health';

describe('CloudinaryHealthIndicator', () => {
  const build = (
    cloudName: string | undefined,
    ping?: jest.Mock,
    injected = true,
  ) =>
    new CloudinaryHealthIndicator(
      new HealthIndicatorService(),
      { get: jest.fn().mockReturnValue(cloudName) } as unknown as ConfigService,
      injected ? ({ api: { ping } } as unknown as typeof CloudinaryType) : null,
    );

  it('reports up/not_configured without a cloud name', async () => {
    expect(
      (await build(undefined).isHealthy('cloudinary')).cloudinary,
    ).toMatchObject({
      status: 'up',
      state: 'not_configured',
    });
  });

  it('reports up/not_injected when the provider is missing', async () => {
    expect(
      (await build('c', undefined, false).isHealthy('cloudinary')).cloudinary,
    ).toMatchObject({ status: 'up', state: 'not_injected' });
  });

  it('reports up/ok when ping returns ok', async () => {
    const ping = jest.fn().mockResolvedValue({ status: 'ok' });

    expect(
      (await build('c', ping).isHealthy('cloudinary')).cloudinary,
    ).toMatchObject({
      status: 'up',
      state: 'ok',
      cloudName: 'c',
    });
  });

  it('reports down when ping returns a non-ok status', async () => {
    const ping = jest.fn().mockResolvedValue({ status: 'fail' });

    expect(
      (await build('c', ping).isHealthy('cloudinary')).cloudinary,
    ).toMatchObject({
      status: 'down',
      cloudName: 'c',
      httpStatus: 'fail',
    });
  });

  it('reports degraded (not down) for rate limit errors', async () => {
    const ping = jest.fn().mockRejectedValue(new Error('Rate Limit Exceeded'));

    expect(
      (await build('c', ping).isHealthy('cloudinary')).cloudinary,
    ).toMatchObject({
      status: 'degraded',
      message: 'Rate Limit Exceeded',
    });
  });

  it('reports down for other errors', async () => {
    const ping = jest.fn().mockRejectedValue(new Error('invalid credentials'));

    expect(
      (await build('c', ping).isHealthy('cloudinary')).cloudinary,
    ).toMatchObject({
      status: 'down',
      error: 'invalid credentials',
    });
  });
});
