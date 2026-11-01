import { parseArgs } from 'util';
import { ImportReport } from './gutenberg-importer';

export interface CliArgs {
  mode: 'dry-run' | 'commit';
  sourceDir: string;
  cacheDir: string;
  only?: string;
  ttlMs?: number;
  yesProduction: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== '--'),
    options: {
      'dry-run': { type: 'boolean' },
      commit: { type: 'boolean' },
      'source-dir': { type: 'string' },
      'cache-dir': { type: 'string' },
      only: { type: 'string' },
      'ttl-days': { type: 'string' },
      'yes-production': { type: 'boolean' },
    },
    strict: true,
  });
  if (values['dry-run'] && values.commit) {
    throw new Error('Pass either --dry-run or --commit, not both');
  }
  if (!values['source-dir']) {
    throw new Error(
      '--source-dir <path to the local mirror directory> is required',
    );
  }
  if (values.only !== undefined && !/^\d{1,7}$/.test(values.only)) {
    throw new Error('--only must be an ebook number (digits)');
  }
  let ttlMs: number | undefined;
  if (values['ttl-days'] !== undefined) {
    const d = Number(values['ttl-days']);
    if (!Number.isFinite(d) || d <= 0)
      throw new Error('--ttl-days must be a positive number');
    ttlMs = d * 86_400_000;
  }
  return {
    mode: values.commit ? 'commit' : 'dry-run',
    sourceDir: values['source-dir'],
    cacheDir: values['cache-dir'] ?? '.cache/gutenberg',
    only: values.only,
    ttlMs,
    yesProduction: !!values['yes-production'],
  };
}

export function formatReport(r: ImportReport): string {
  const lines: string[] = [];
  lines.push(r.mode === 'dry-run' ? 'DRY RUN (nothing was written)' : 'COMMIT');
  for (const i of r.items) {
    lines.push(
      `${i.ebookId.padStart(7)}  ${i.outcome.padEnd(22)} ${i.title}${i.reason ? `  [${i.reason}]` : ''}`.replace(
        /^(\s*\d+)\s{2}/,
        '$1 ',
      ),
    );
    if (i.unmapped?.categories.length) {
      lines.push(
        `         unmapped categories: ${i.unmapped.categories.join(', ')}`,
      );
    }
    if (i.unmapped?.themes.length) {
      lines.push(`         unmapped themes: ${i.unmapped.themes.join(', ')}`);
    }
  }
  lines.push(
    `Summary: ${Object.entries(r.summary)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}`,
  );
  if (r.mode === 'dry-run')
    lines.push('Re-run with --commit to write unpublished stories.');
  return lines.join('\n');
}
