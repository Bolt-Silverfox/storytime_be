import {
  parseCliArgs,
  formatReport,
  needsProductionConfirmation,
} from './gutenberg-cli.args';

describe('parseCliArgs', () => {
  it('defaults to dry-run', () => {
    expect(parseCliArgs(['--source-dir', '/m']).mode).toBe('dry-run');
  });
  it('ignores the pnpm "--" separator', () => {
    const a = parseCliArgs(['--', '--commit', '--source-dir', '/m']);
    expect(a.mode).toBe('commit');
  });
  it('--dry-run is explicit dry-run', () => {
    expect(parseCliArgs(['--dry-run', '--source-dir', '/m']).mode).toBe(
      'dry-run',
    );
  });
  it('rejects --dry-run together with --commit', () => {
    expect(() =>
      parseCliArgs(['--dry-run', '--commit', '--source-dir', '/m']),
    ).toThrow(/both/i);
  });
  it('requires --source-dir', () => {
    expect(() => parseCliArgs(['--commit'])).toThrow(/source-dir/);
  });
  it('validates --only as digits and --ttl-days as a positive number', () => {
    expect(() => parseCliArgs(['--source-dir', '/m', '--only', 'x1'])).toThrow(
      /only/,
    );
    expect(() =>
      parseCliArgs(['--source-dir', '/m', '--ttl-days', '0']),
    ).toThrow(/ttl/);
    const a = parseCliArgs([
      '--source-dir',
      '/m',
      '--only',
      '14838',
      '--ttl-days',
      '2',
    ]);
    expect(a.only).toBe('14838');
    expect(a.ttlMs).toBe(2 * 86_400_000);
  });
  it('rejects unknown flags', () => {
    expect(() => parseCliArgs(['--source-dir', '/m', '--nope'])).toThrow();
  });
});

describe('formatReport', () => {
  it('prints mode, one line per work and the summary; says nothing was written for dry-run', () => {
    const out = formatReport({
      mode: 'dry-run',
      items: [
        {
          ebookId: '1',
          title: 'T',
          outcome: 'create',
          written: false,
          unmapped: { categories: ['X'], themes: [] },
        },
        {
          ebookId: '2',
          title: 'U',
          outcome: 'needs-review',
          reason: 'why',
          written: false,
        },
      ],
      summary: { create: 1, 'needs-review': 1 },
    });
    expect(out).toMatch(/DRY RUN/);
    expect(out).toMatch(/nothing was written/i);
    expect(out).toMatch(/1\s+create\s+T/);
    expect(out).toMatch(/unmapped categories: X/);
    expect(out).toMatch(/why/);
  });
});

describe('needsProductionConfirmation', () => {
  it.each([
    'postgresql://u:p@localhost:5432/db',
    'postgresql://u:p@127.0.0.1:55731/db',
    'postgresql://u:p@[::1]:5432/db',
    'postgresql://u:p@LOCALHOST/db',
    'postgresql://u@/db?host=/var/run/postgresql',
  ])('local database needs no confirmation: %s', (u) => {
    expect(needsProductionConfirmation(u)).toBe(false);
  });
  it.each([
    'postgresql://u:p@db.example.com:5432/db',
    'postgresql://u:p@10.0.0.5/db',
    'postgresql://u:p@localhost.evil.com/db',
    'postgresql://u:p@notlocal/db',
    'postgresql://u:p@evil.local.example.com/db',
    'postgresql://u:p@box.local/db',
    'postgresql://u:p@printer.local:5432/db',
    'not a url',
    '',
    undefined,
  ])('anything else needs --yes-production: %s', (u) => {
    expect(needsProductionConfirmation(u)).toBe(true);
  });
});

describe('--allow-unverified-ids', () => {
  it('defaults off and is parsed', () => {
    expect(parseCliArgs(['--source-dir', '/m']).allowUnverifiedIds).toBe(false);
    expect(
      parseCliArgs(['--source-dir', '/m', '--allow-unverified-ids'])
        .allowUnverifiedIds,
    ).toBe(true);
  });
});

describe('formatReport editor notes', () => {
  it('prints editor notes', () => {
    const out = formatReport({
      mode: 'dry-run',
      items: [
        {
          ebookId: '55',
          title: 'Oz',
          outcome: 'create',
          written: false,
          editorNotes: ['violence: review passages'],
        },
      ],
      summary: { create: 1 },
    });
    expect(out).toMatch(/note: violence: review passages/);
  });
});
