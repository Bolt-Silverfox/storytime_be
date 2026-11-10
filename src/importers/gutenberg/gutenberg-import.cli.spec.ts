import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('gutenberg import CLI environment loading', () => {
  let cwd: string;
  const repoRoot = path.resolve(__dirname, '../../..');
  const cliPath = path.resolve(__dirname, 'gutenberg-import.cli.ts');

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gutenberg-cli-'));
    fs.mkdirSync(path.join(cwd, 'mirror'));
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const run = (databaseUrl: string, extra: string[]) => {
    fs.writeFileSync(path.join(cwd, '.env'), `DATABASE_URL=${databaseUrl}\n`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TS_NODE_PROJECT: path.join(repoRoot, 'tsconfig.json'),
    };
    delete env.DATABASE_URL;
    const r = spawnSync(
      process.execPath,
      [
        '-r',
        path.join(repoRoot, 'node_modules/ts-node/register/transpile-only'),
        '-r',
        path.join(repoRoot, 'node_modules/tsconfig-paths/register'),
        cliPath,
        '--source-dir',
        path.join(cwd, 'mirror'),
        ...extra,
      ],
      { cwd, timeout: 20000, encoding: 'utf8', env },
    );
    return `${r.stdout}${r.stderr}`;
  };

  it('refuses --commit when .env holds a remote DATABASE_URL', () => {
    const out = run('postgresql://u:p@db.example.com:5432/app', ['--commit']);
    expect(out).toContain('Refusing --commit');
  });

  it('does not refuse --commit when .env holds a localhost DATABASE_URL', () => {
    const out = run('postgresql://u:p@localhost:5432/app', ['--commit']);
    expect(out).not.toContain('Refusing --commit');
  });
});
