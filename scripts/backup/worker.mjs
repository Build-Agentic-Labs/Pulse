import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {ownsRunnerLock,releaseRunnerLock} from './runner-lock.mjs';
import { productionRecords } from './source.mjs';
import { writeArchive, verifyArchive } from './archive.mjs';
const [id, owner] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(id || '') || !/^[a-f0-9-]{36}$/.test(owner || '')) process.exit(1);
const root = path.resolve('backups/local');
await mkdir(root, { recursive: true, mode: 0o700 });
if (!await ownsRunnerLock(root,id,owner)) process.exit(1);
const statusPath = path.join(root, `${id}.json`), archive = path.join(root, `${id}.pulsebackup`);
let phase = 'starting', statusQueue = Promise.resolve();
function status(state, extra = {}) {
  statusQueue = statusQueue.then(async () => {
  const value = { id, owner, state, phase, updatedAt: new Date().toISOString(), ...extra };
  await writeFile(`${statusPath}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${statusPath}.tmp`, statusPath);
  });
  return statusQueue;
}
let password = '';
for await (const chunk of process.stdin) password += chunk;
try {
  const config = { caCertificate: process.env.PULSE_BACKUP_CA_CERT, databaseUrl: process.env.PULSE_BACKUP_DATABASE_URL, pgDump: process.env.PULSE_BACKUP_PG_DUMP || 'pg_dump', storageUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, storageReadToken: process.env.PULSE_BACKUP_STORAGE_READ_TOKEN, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  if (process.env.NODE_ENV === 'production' || process.env.PULSE_LOCAL_BACKUPS !== 'true' || process.env.PULSE_BACKUP_RESTORE_VALIDATED !== 'true' || Object.values(config).some((value) => !value)) throw new Error('Read-only setup and isolated restore validation are required.');
  await status('running');
  async function* records() {
    yield { type: 'format', version: 1, createdAt: new Date().toISOString(), restoreTested: false };
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const sourcePaths = ['app', 'src', 'public', 'scripts/backup', 'supabase/migrations', 'package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.mjs'];
    const dirty = await promisify(execFile)('git', ['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths]);
    if (dirty.stdout.trim()) throw new Error('Commit the reviewed application changes before exporting its recovery source.');
    const commit = await promisify(execFile)('git', ['rev-parse', 'HEAD']);
    yield { type: 'application', commit: commit.stdout.trim() };
    const source = await promisify(execFile)('git', ['archive', commit.stdout.trim(), ...sourcePaths], { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
    yield { type: 'application-source', format: 'tar', data: source.stdout.toString('base64') };
    // Recovery definitions are explicit tracked migrations, never environment files.
    const files = await promisify(execFile)('git', ['ls-tree', '-r', '--name-only', commit.stdout.trim(), '--', 'supabase/migrations']);
    for (const file of files.stdout.trim().split('\n').filter(Boolean)) yield { type: 'migration', name: file, sql: (await promisify(execFile)('git', ['show', `${commit.stdout.trim()}:${file}`], { maxBuffer: 32 * 1024 * 1024 })).stdout };
    for await (const record of productionRecords(config, (next) => { phase = next; })) yield record;
  }
  const timer = setInterval(() => { void status('running').catch(() => {}); }, 2000);
  try { await writeArchive(archive, password, records()); }
  finally { clearInterval(timer); }
  phase = 'verifying'; await status('running');
  const verified = await verifyArchive(archive, password);
  await status('complete', { ...verified, filename: `${id}.pulsebackup` });
} catch {
  // Preserve every existing or completed archive, even when verification fails.
  // Failed jobs are never offered for download; an operator can inspect the file.
  await status('failed', { error: 'Backup could not be completed or verified. Production data was not changed. Check the read-only setup, restore-validation gate and committed application source before retrying.' });
} finally { password = ''; await releaseRunnerLock(root,id,owner).catch(() => {}); }
