import { isThrowawayDatabaseUrl } from './throwaway-database';

describe('isThrowawayDatabaseUrl', () => {
  it.each([
    'postgresql://u:p@localhost:5432/storytime_test',
    'postgresql://u:p@localhost:5432/pwl_throwaway',
    'postgresql://u:p@localhost:5432/throwaway?schema=public',
    'postgres://u:p@localhost:5432/pwl_throwaway',
    'postgresql://u:p@127.0.0.1:5432/storytime_test',
    'postgresql://u:p@[::1]:5432/storytime_test',
    'postgresql:///storytime_test',
  ])('accepts %s', (url) => {
    expect(isThrowawayDatabaseUrl(url)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'not a url',
    'postgres://h/prod/x_test',
    'postgresql://u:p@throwaway.example.com/prod',
    'postgresql://u:p@localhost/x_test?dbname=prod',
    'postgresql://u:p@localhost/x_test?host=/var/run/postgresql',
    'postgresql://u:p@h/production_test_data',
    'https://example.com/storytime_test',
    'mysql://u:p@h/storytime_test',
    'postgresql://u:p@shared.example.com:5432/storytime_test',
  ])('rejects %s', (url) => {
    expect(isThrowawayDatabaseUrl(url)).toBe(false);
  });
});
