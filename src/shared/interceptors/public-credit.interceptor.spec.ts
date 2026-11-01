import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { PublicCreditInterceptor } from './public-credit.interceptor';
import { AppModule } from '@/app.module';

const ctx = (url: string, type = 'http') =>
  ({
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, url }) }),
  }) as unknown as ExecutionContext;

const row = () => ({
  licenseCode: 'PD-US',
  sourceName: 'gutenberg',
  sourceUrl: 'https://x',
  attributionText: 'credit',
});
const run = (url: string, data: unknown) =>
  lastValueFrom(
    new PublicCreditInterceptor().intercept(ctx(url), {
      handle: () => of(data),
    } as CallHandler),
  );

describe('PublicCreditInterceptor', () => {
  it.each([
    '/api/v1/stories',
    '/api/v1/stories/abc',
    '/api/v1/guest/stories/abc',
    '/api/v1/favourites',
    '/api/v1/library?x=1',
    '/api/v1/stories/downloads',
  ])('masks provenance source fields on %s', async (url) => {
    const out: any = await run(url, { items: [{ story: row() }] });
    expect(out.items[0].story.sourceName).toBeNull();
    expect(out.items[0].story.sourceUrl).toBeNull();
    expect(out.items[0].story.attributionText).toBe('credit');
  });

  it.each(['/api/v1/admin/stories/abc', '/api/v1/admin/stories?x=1', '/admin/x'])(
    'leaves admin responses alone: %s',
    async (url) => {
      const out: any = await run(url, { story: row() });
      expect(out.story.sourceName).toBe('gutenberg');
      expect(out.story.sourceUrl).toBe('https://x');
    },
  );

  it('does not treat a path that merely contains "admin" as admin', async () => {
    const out: any = await run('/api/v1/stories/administer', { s: row() });
    expect(out.s.sourceName).toBeNull();
  });

  it('is registered as a global APP_INTERCEPTOR in AppModule', () => {
    const providers: any[] = Reflect.getMetadata('providers', AppModule);
    expect(
      providers.some(
        (p) =>
          p && p.provide === APP_INTERCEPTOR && p.useClass === PublicCreditInterceptor,
      ),
    ).toBe(true);
    void Reflector;
  });
});
