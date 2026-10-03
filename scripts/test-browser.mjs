import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

// Fixed project and ports prevent inherited production credentials or an existing
// development server from becoming the target of destructive test setup.
const workdir = 'scratch/browser-db';
const cli = ['--yes', 'supabase@2.119.0'];
function run(command, args, env = process.env, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    let errors = '';
    if (capture) child.stderr.on('data', (chunk) => { errors += chunk; });
    if (capture) child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} ${args[0]} failed (${code})${capture ? `\n${errors}` : ''}`)));
  });
}
await mkdir(`${workdir}/supabase`, { recursive: true });
const config = (await readFile('supabase/config.toml', 'utf8'))
  .replace('project_id = "pulse"', 'project_id = "pulse-e2e"').replaceAll('553', '563');
await writeFile(`${workdir}/supabase/config.toml`, config);
for (const name of ['migrations', 'templates', 'seed.sql']) {
  await cp(`supabase/${name}`, `${workdir}/supabase/${name}`, { recursive: true, force: true });
}
try {
  console.log('Starting isolated browser-test services…');
  // CLI startup prints local API keys; keep them out of retained CI logs.
  await run('npx', [...cli, 'start', '--workdir', workdir, '-x', 'studio,postgres-meta,edge-runtime,logflare,vector,supavisor,imgproxy,mailpit'], process.env, true);
  await run('npx', [...cli, 'db', 'reset', '--local', '--workdir', workdir]);
  const status = JSON.parse(await run('npx', [...cli, 'status', '--workdir', workdir, '-o', 'json'], process.env, true));
  if (status.API_URL !== 'http://127.0.0.1:56321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error('Browser tests require the isolated local Supabase API.');
  }
  const env = { ...process.env, PULSE_BROWSER_TEST: '1',
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, E2E_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    RESEND_API_KEY: '', ANTHROPIC_API_KEY: '', NEXT_PUBLIC_WEB_VITALS_ENDPOINT: '' };
  await run('npm', ['run', 'build'], env);
  await run('npx', ['playwright', 'test', ...process.argv.slice(2)], env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await run('npx', [...cli, 'stop', '--workdir', workdir]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
