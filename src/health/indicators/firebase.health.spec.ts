import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { getApp } from 'firebase-admin/app';
import { FirebaseHealthIndicator } from './firebase.health';

jest.mock('firebase-admin/app', () => ({ getApp: jest.fn() }));

describe('FirebaseHealthIndicator', () => {
  const build = (projectId?: string) =>
    new FirebaseHealthIndicator(new HealthIndicatorService(), {
      get: jest.fn().mockReturnValue(projectId),
    } as unknown as ConfigService);

  beforeEach(() => jest.clearAllMocks());

  // `status` is reserved by terminus 12, so the descriptive state lives in
  // `state`; the terminus status itself stays `up` for these optional cases.
  it('reports up/not_configured when no project id is configured', async () => {
    expect(await build(undefined).isHealthy('firebase')).toEqual({
      firebase: {
        status: 'up',
        state: 'not_configured',
        duration: expect.stringMatching(/^\d+ms$/),
        message: 'Firebase not configured (optional service)',
      },
    });
  });

  it('reports up/not_initialized when the SDK has no app yet', async () => {
    (getApp as jest.Mock).mockImplementation(() => {
      throw new Error('no app');
    });

    const result = await build('proj').isHealthy('firebase');
    expect(result.firebase).toMatchObject({
      status: 'up',
      state: 'not_initialized',
    });
  });

  it('reports up/initialized when the project ids match', async () => {
    (getApp as jest.Mock).mockReturnValue({ options: { projectId: 'proj' } });

    expect((await build('proj').isHealthy('firebase')).firebase).toMatchObject({
      status: 'up',
      state: 'initialized',
      projectId: 'proj',
    });
  });

  it('reports down on a project id mismatch', async () => {
    (getApp as jest.Mock).mockReturnValue({ options: { projectId: 'other' } });

    expect((await build('proj').isHealthy('firebase')).firebase).toEqual({
      status: 'down',
      duration: expect.stringMatching(/^\d+ms$/),
      configured: 'proj',
      actual: 'other',
      error: 'Project ID mismatch',
    });
  });
});
