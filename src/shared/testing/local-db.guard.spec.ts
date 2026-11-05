import { canRunDestructiveDbTests } from './local-db.guard';

describe('canRunDestructiveDbTests', () => {
  it.each([
    'postgresql://u:p@localhost:5432/db',
    'postgresql://u:p@127.0.0.1:5432/db',
    'postgresql://u:p@[::1]:5432/db',
  ])('allows a local database: %s', (url) => {
    expect(canRunDestructiveDbTests(url)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'postgresql://u:p@db.prod.example.com:5432/db',
    'postgresql://u:p@10.0.0.5:5432/db',
    'not a url',
  ])('refuses a missing, remote or unparseable database: %s', (url) => {
    expect(canRunDestructiveDbTests(url)).toBe(false);
  });
});
