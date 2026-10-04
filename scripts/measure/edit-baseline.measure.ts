// Edit-reliability baseline measurement (docs/edit-reliability-plan.md, Package A).
// Runs ONLY through scripts/measure-edit-baseline.mjs against the isolated local database on
// 127.0.0.1:56321. Seeds deterministic synthetic fixtures (sizes fixed, ids unique per run) into fresh
// workspaces, then records, per sample: Supabase requests by endpoint, bytes transferred, and the time
// from the user's action to the row being observable in the database. No production system is touched.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const api = 'http://127.0.0.1:56321';
const password = 'Measure-test-Password-42!';
const outDir = process.env.MEASURE_OUT!;
const samplesPerFixture = Number(process.env.MEASURE_SAMPLES ?? '5');
const settleMs = 2500; // identical to the historical request-count spec
const db = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' });
const admin = createClient(api, process.env.E2E_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
test.afterAll(async () => { await db.end(); });

type FixtureSpec = { zones: number; stations: number; tasks: number; stepsPerTask: number; toolsPerStep: number; heavyTaskTools: number };
// small reproduces the historical 61/5 fixture exactly (1 task, 1 step, no zones/stations/tools).
// medium is a plausible workflow; it is NOT a measured "typical production project".
// stress crosses the 500-row read page (tasks, steps, step_tools) and the 1,000-row API cap (step_tools on one task).
const fixtures: Record<string, FixtureSpec> = {
  small: { zones: 0, stations: 0, tasks: 1, stepsPerTask: 1, toolsPerStep: 0, heavyTaskTools: 0 },
  medium: { zones: 3, stations: 6, tasks: 40, stepsPerTask: 5, toolsPerStep: 2, heavyTaskTools: 0 },
  stress: { zones: 2, stations: 4, tasks: 1100, stepsPerTask: 1, toolsPerStep: 0, heavyTaskTools: 1100 },
};

type Bucket = { requests: Record<string, { count: number; requestBytes: number; responseBytes: number; failed: number }>; appRequests: number; appResponseBytes: number; durationMs?: number };
type Sample = {
  fixture: string; sample: number; cold: boolean; startedAt: string; browser: string;
  phases: Record<string, Bucket>;
  persistence: { fromBlurToDbMs: number | null; pollIntervalMs: number; confirmedValue: boolean; };
  pageErrors: string[];
};

async function bulkInsert(table: string, columns: string[], rows: unknown[][]) {
  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => `(${row.map((value) => { values.push(value); return `$${values.length}`; }).join(',')})`);
    await db.query(`insert into ${table}(${columns.join(',')}) values ${tuples.join(',')}`, values);
  }
}

async function seedFixture(name: string, spec: FixtureSpec) {
  const run = randomUUID().slice(0, 8);
  const workspace = `ws-measure-${name}-${run}`;
  const domain = `measure-${name}-${run}.test`;
  const email = `user@${domain}`;
  await db.query('insert into workspaces(id,name) values($1,$2)', [workspace, `Measurement ${name}`]);
  await db.query('insert into workspace_auto_join_domains(domain,workspace_id) values($1,$2)', [domain, workspace]);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Measurement User' } });
  if (error) throw error;
  const user = data.user.id;
  await db.query('insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3)', [workspace, user, 'editor']);
  const connection = await db.connect();
  let projectId: string;
  try {
    await connection.query('begin');
    await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await connection.query('set local role authenticated');
    projectId = (await connection.query('select public.create_project_with_starter_plan($1,$2) id', [workspace, `Measurement product ${name}`])).rows[0].id;
    await connection.query('commit');
  } catch (caught) { await connection.query('rollback'); throw caught; } finally { connection.release(); }
  const scenario = (await db.query('select s.id from scenarios s join products p on p.id=s.product_id where p.project_id=$1', [projectId])).rows[0].id;
  const id = (kind: string, n: number) => `m-${name}-${run}-${kind}-${n}`;
  const zones = Array.from({ length: spec.zones }, (_, i) => [id('zone', i + 1), scenario, i + 1, `Zone ${i + 1}`]);
  await bulkInsert('zones', ['id', 'scenario_id', 'sequence', 'name'], zones);
  const stations = Array.from({ length: spec.stations }, (_, i) => [id('station', i + 1), scenario, i + 1, `Station ${i + 1}`]);
  await bulkInsert('stations', ['id', 'scenario_id', 'sequence', 'name'], stations);
  const base = Date.UTC(2026, 0, 5, 8, 0, 0);
  const tasks = Array.from({ length: spec.tasks }, (_, i) => [
    id('task', i + 1), scenario, `Task ${i + 1}`, String(i + 1),
    new Date(base + i * 60_000).toISOString(), new Date(base + (i + 1) * 60_000).toISOString(), 60, 1,
    spec.stations ? stations[i % spec.stations][0] : null, spec.zones ? zones[i % spec.zones][0] : null,
  ]);
  await bulkInsert('tasks', ['id', 'scenario_id', 'name', 'wbs', 'planned_start', 'planned_finish', 'planned_duration_minutes', 'planned_operators', 'station_id', 'zone_id'], tasks);
  const steps: unknown[][] = [];
  for (let t = 0; t < spec.tasks; t++) for (let s = 0; s < spec.stepsPerTask; s++) {
    steps.push([id('step', t * spec.stepsPerTask + s + 1), tasks[t][0], s + 1, `Step ${s + 1}`, `Instruction ${s + 1} of task ${t + 1}.`, 5]);
  }
  await bulkInsert('manufacturing_steps', ['id', 'task_id', 'sequence', 'name', 'instruction', 'duration_minutes'], steps);
  const tools: unknown[][] = [];
  for (let t = 0; t < spec.tasks; t++) for (let s = 0; s < spec.stepsPerTask; s++) for (let k = 0; k < spec.toolsPerStep; k++) {
    tools.push([tasks[t][0], steps[t * spec.stepsPerTask + s][0], `Tool ${k + 1}`, k + 1]);
  }
  for (let k = 0; k < spec.heavyTaskTools; k++) tools.push([tasks[0][0], steps[0][0], `Heavy tool ${k + 1}`, k + 1]);
  await bulkInsert('step_tools', ['task_id', 'step_id', 'tool_name', 'sequence'], tools);
  const counts = { zones: zones.length, stations: stations.length, tasks: tasks.length, manufacturing_steps: steps.length, step_tools: tools.length };
  return { workspace, email, user, projectId, scenario, firstTaskId: tasks[0][0] as string, firstStepId: steps[0][0] as string, counts, run };
}

async function authenticate(context: BrowserContext, email: string) {
  const client = createServerClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [], setAll: async (cookies) => { await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const }))); } },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

function recorder(page: Page, phases: Record<string, Bucket>, current: () => string) {
  const bucket = () => (phases[current()] ??= { requests: {}, appRequests: 0, appResponseBytes: 0 });
  const key = (url: string, method: string) => `${method} ${new URL(url).pathname.replace(/\/storage\/v1\/object\/sign\/.*/, '/storage/v1/object/sign/*')}`;
  page.on('requestfinished', async (request) => {
    const url = request.url();
    const sizes = await request.sizes().catch(() => ({ requestBodySize: 0, requestHeadersSize: 0, responseBodySize: 0, responseHeadersSize: 0 }));
    const b = bucket();
    if (url.startsWith(api)) {
      const entry = (b.requests[key(url, request.method())] ??= { count: 0, requestBytes: 0, responseBytes: 0, failed: 0 });
      entry.count += 1;
      entry.requestBytes += sizes.requestBodySize + sizes.requestHeadersSize;
      entry.responseBytes += sizes.responseBodySize + sizes.responseHeadersSize;
    } else if (url.startsWith('http://127.0.0.1:3100')) {
      b.appRequests += 1;
      b.appResponseBytes += sizes.responseBodySize + sizes.responseHeadersSize;
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!url.startsWith(api)) return;
    const entry = (bucket().requests[key(url, request.method())] ??= { count: 0, requestBytes: 0, responseBytes: 0, failed: 0 });
    entry.failed += 1;
  });
}

async function runSample(browser: Browser, fixtureName: string, fx: Awaited<ReturnType<typeof seedFixture>>, sampleIndex: number): Promise<Sample> {
  const context = await browser.newContext();
  await authenticate(context, fx.email);
  const page = await context.newPage();
  const phases: Record<string, Bucket> = {};
  let phase = 'open';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  recorder(page, phases, () => phase);
  const timed = async (name: string, action: () => Promise<void>) => {
    phase = name;
    const t0 = performance.now();
    await action();
    phases[name] ??= { requests: {}, appRequests: 0, appResponseBytes: 0 };
    phases[name].durationMs = Math.round(performance.now() - t0);
    await page.waitForTimeout(settleMs);
  };
  await timed('open', async () => {
    await page.goto(`/projects/${fx.projectId}/planner`);
    await expect(page.getByRole('button', { name: 'Gantt', exact: true }).first()).toBeVisible();
  });
  await timed('switch:Procedure', async () => {
    await page.getByRole('button', { name: 'Procedure', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toBeVisible();
  });
  const value = `Measured instruction ${fixtureName} ${fx.run} sample ${sampleIndex}.`;
  const pollIntervalMs = 20;
  let fromBlurToDbMs: number | null = null;
  await timed('edit:step-instruction', async () => {
    const box = page.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
    await box.fill(value);
    const t0 = performance.now();
    await box.blur();
    const deadline = t0 + 60_000;
    while (performance.now() < deadline) {
      const { rows } = await db.query('select instruction from manufacturing_steps where id=$1', [fx.firstStepId]);
      if (rows[0]?.instruction === value) { fromBlurToDbMs = Math.round(performance.now() - t0); break; }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  });
  await timed('mobile:open', async () => {
    await page.goto(`/projects/${fx.projectId}/mobile-photos`);
    await expect(page.locator('h1.ui-photo-mobile-page-title')).toBeVisible();
  });
  const sample: Sample = {
    fixture: fixtureName, sample: sampleIndex, cold: sampleIndex === 1, startedAt: new Date().toISOString(), browser: browser.version(),
    phases, persistence: { fromBlurToDbMs, pollIntervalMs, confirmedValue: fromBlurToDbMs !== null }, pageErrors,
  };
  await context.close();
  return sample;
}

for (const [fixtureName, spec] of Object.entries(fixtures)) {
  test(`measure ${fixtureName}`, async ({ browser }) => {
    mkdirSync(outDir, { recursive: true });
    const seededAt = performance.now();
    const fx = await seedFixture(fixtureName, spec);
    writeFileSync(join(outDir, `fixture-${fixtureName}.json`), JSON.stringify({ fixture: fixtureName, spec, counts: fx.counts, projectId: fx.projectId, scenarioId: fx.scenario, workspace: fx.workspace, seedMs: Math.round(performance.now() - seededAt) }, null, 2));
    for (let i = 1; i <= samplesPerFixture; i++) {
      const sample = await runSample(browser, fixtureName, fx, i);
      writeFileSync(join(outDir, `sample-${fixtureName}-${String(i).padStart(2, '0')}.json`), JSON.stringify(sample, null, 2));
      expect(sample.persistence.confirmedValue, `edit persisted (${fixtureName} #${i})`).toBe(true);
    }
  });
}
