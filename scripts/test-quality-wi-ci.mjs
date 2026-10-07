import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Hosted CI only. Never reset or delete a database or volume, including retained local fixtures.
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This runner is restricted to GitHub Actions.');
const project = 'pulse-quality-wi-20261006';
const workdir = 'scratch/quality-wi-build/db';
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status})`);
  return result.stdout?.trim() ?? '';
}
const existing = run('docker', ['ps', '-a', '--filter', `label=com.supabase.cli.project=${project}`, '--format', '{{.Names}}'], true);
assert.equal(existing, '', 'Refusing to use existing WI containers.');
const volumes = run('docker', ['volume', 'ls', '--format', '{{.Name}}'], true).split('\n');
assert(!volumes.some(name => name.endsWith(`_${project}`)), 'Refusing to use retained WI volumes.');
mkdirSync(`${workdir}/supabase`, { recursive: true });
const config = readFileSync('supabase/config.toml', 'utf8');
assert(config.includes('project_id = "pulse"'));
writeFileSync(`${workdir}/supabase/config.toml`, config.replace('project_id = "pulse"', `project_id = "${project}"`).replaceAll('553', '577'));
for (const name of ['migrations', 'templates', 'seed.sql']) cpSync(`supabase/${name}`, `${workdir}/supabase/${name}`, { recursive: true });
const cli = ['--yes', 'supabase@2.119.0'];
try {
  // Fresh project start applies migrations/seed. Capture startup output to avoid logging API keys.
  run('npx', [...cli, 'start', '--workdir', workdir, '-x', 'studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit'], true);
  run('node', ['tests/quality-work-instructions/local-runtime.mjs', 'setup']);
  run('node', ['tests/quality-work-instructions/local-runtime.mjs', 'build']);
  run('node', ['tests/quality-work-instructions/local-runtime.mjs', 'browser']);
} finally {
  run('npx', [...cli, 'stop', '--workdir', workdir], true);
}
