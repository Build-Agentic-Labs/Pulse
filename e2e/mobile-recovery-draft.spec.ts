import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';

// Real-browser characterization of the phone New Step recovery draft: actual Chromium IndexedDB in an
// isolated Playwright context (fresh profile, nothing of a real user's), synthetic records only.
const api = 'http://127.0.0.1:56321';
const password = 'Browser-test-Password-42!';
const db = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' });
const admin = createClient(api, process.env.E2E_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
test.afterAll(async () => { await db.end(); });

const DB_NAME = 'buildlogic-mobile-drafts';
const STORE = 'drafts';

function readRecoveryRecord(page: Page, key: string) {
  return page.evaluate(([dbName, store, key]) => new Promise<Record<string, unknown> | null>((resolve, reject) => {
    const open = indexedDB.open(dbName, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store, { keyPath: 'key' }); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const request = database.transaction(store, 'readonly').objectStore(store).get(key);
      request.onerror = () => { database.close(); reject(request.error); };
      request.onsuccess = () => { database.close(); resolve((request.result as Record<string, unknown> | undefined) ?? null); };
    };
  }), [DB_NAME, STORE, key] as const);
}

async function fixture() {
  const workspace = `ws-recovery-${randomUUID()}`;
  const domain = `recovery-${randomUUID()}.test`;
  const email = `one@${domain}`;
  await db.query('insert into workspaces(id,name) values($1,$2)', [workspace, 'Recovery org']);
  await db.query('insert into workspace_auto_join_domains(domain,workspace_id) values($1,$2) on conflict(domain) do update set workspace_id=excluded.workspace_id', [domain, workspace]);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Recovery Tester' } });
  if (error) throw error;
  const user = data.user.id;

  await db.query('insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3) on conflict(workspace_id,user_id) do update set role=excluded.role', [workspace, user, 'editor']);
  const connection = await db.connect();
  let projectId: string;
  try {
    await connection.query('begin');
    await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await connection.query('set local role authenticated');
    projectId = (await connection.query('select public.create_project_with_starter_plan($1,$2) id', [workspace, 'Recovery product'])).rows[0].id;
    await connection.query('commit');
  } catch (caught) { await connection.query('rollback'); throw caught; } finally { connection.release(); }
  const scenario = (await db.query('select s.id from scenarios s join products p on p.id=s.product_id where p.project_id=$1', [projectId])).rows[0].id;
  const taskId = `recovery-task-${randomUUID()}`;
  await db.query(`insert into tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators) values($1,$2,'Recovery task','1',now(),now(),60,1)`, [taskId, scenario]);

  const secondTask = `recovery-task-${randomUUID()}`;
  await db.query(`insert into tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators) values($1,$2,'Second task','2',now(),now(),60,1)`, [secondTask, scenario]);
  const secondUser = await admin.auth.admin.createUser({ email: `two@${domain}`, password, email_confirm: true });
  if (secondUser.error) throw secondUser.error;
  await db.query('insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3) on conflict(workspace_id,user_id) do update set role=excluded.role', [workspace, secondUser.data.user.id, 'editor']);
  await db.query("insert into project_access(project_id,user_id,level) values($1,$2,'edit') on conflict(project_id,user_id) do update set level='edit'", [projectId, secondUser.data.user.id]);
  return { projectId, taskId, secondTask, user, otherUser: secondUser.data.user.id, email, otherEmail: `two@${domain}` };
}

async function signIn(context: import('@playwright/test').BrowserContext, email: string) {
  await context.clearCookies();
  const auth = createServerClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => [], setAll: async (cookies) => { await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const }))); } } });
  const signIn = await auth.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
 }

function scopedKey(userId: string, projectId: string, taskId: string) {
  return `mobile-new-step-draft-v2:${[userId, projectId, taskId].map(encodeURIComponent).join(':')}`;
}
async function blockStepWrites(page: Page) {
  await page.route('**/rest/v1/manufacturing_steps*', async (route) => {
    if (route.request().method() !== 'GET') await route.abort(); else await route.continue();
  });
}
async function openDraft(page: Page, projectId: string, name = /Recovery task \d+ steps?/) {
  await page.goto(`/projects/${projectId}/mobile-photos`);
  await expect(page.getByRole('heading', { name: 'Recovery product' })).toBeVisible();
  if (!(await page.getByRole('textbox', { name: 'Process name' }).isVisible())) await page.getByRole('button', { name }).click();
  const input = page.getByRole('textbox', { name: 'New step name', exact: true });
  if (!(await input.isVisible())) await page.getByRole('button', { name: 'Add step' }).click();
  return input;
}

test('recovery draft: save, overwrite, survive reload, clear once the step is saved', async ({ context, page }) => {
  const { projectId, taskId, user, email } = await fixture();
  await signIn(context, email);
  const KEY = scopedKey(user, projectId, taskId);

  // Block step writes so the draft cannot complete and the recovery record stays in IndexedDB.
  let blocked = true;
  await page.route('**/rest/v1/manufacturing_steps*', async (route) => {
    if (blocked && route.request().method() !== 'GET') await route.abort();
    else await route.continue();
  });

  await page.goto(`/projects/${projectId}/mobile-photos`);
  await page.getByRole('button', { name: /Recovery task \d+ steps?/ }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  const name = page.getByRole('textbox', { name: 'New step name', exact: true });
  await name.fill('Draft one');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();

  // save
  const first = (await readRecoveryRecord(page, KEY))!;
  // durationText is derived from the task's planned duration (60 min here), not a fixed default.
  expect(first).toMatchObject({ key: KEY, taskId, name: 'Draft one', instruction: '', durationText: '60', tools: [], photos: [], checks: [] });
  expect(typeof first.stepId).toBe('string');
  expect(new Date(first.updatedAt as string).toISOString()).toBe(first.updatedAt);

  // overwrite
  await name.fill('Draft one two');
  await expect.poll(async () => (await readRecoveryRecord(page, KEY))?.name).toBe('Draft one two');
  const second = (await readRecoveryRecord(page, KEY))!;
  expect(second.stepId).toBe(first.stepId);
  expect(Date.parse(second.updatedAt as string)).toBeGreaterThanOrEqual(Date.parse(first.updatedAt as string));

  // reload / read: the draft is restored from IndexedDB and re-saved (still blocked, so it stays)
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'New step name', exact: true })).toHaveValue('Draft one two');
  await expect(page.getByText(/Recovered an unsaved phone draft/)).toBeVisible();
  // The recovery re-save (250 ms later) is still blocked, so it fails and the record survives it.
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  expect((await readRecoveryRecord(page, KEY))?.name).toBe('Draft one two');
  expect((await db.query('select count(*)::int n from manufacturing_steps where task_id=$1', [taskId])).rows[0].n).toBe(0);

  // clear: once the step actually saves, the record goes away
  blocked = false;
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect.poll(async () => (await db.query('select name from manufacturing_steps where task_id=$1', [taskId])).rows.map((row) => row.name)).toEqual(['Draft one two']);
  await expect.poll(() => readRecoveryRecord(page, KEY)).toBeNull();
});


test('scoped drafts survive task and product switches in real IndexedDB', async ({ context, page }) => {
  const first = await fixture(); const second = await fixture();
  await signIn(context, first.email); await blockStepWrites(page);
  const keyA = scopedKey(first.user, first.projectId, first.taskId);
  const name = await openDraft(page, first.projectId); await name.fill('Task A pending');
  await expect.poll(async () => (await readRecoveryRecord(page, keyA))?.name).toBe('Task A pending');
  await page.getByRole('button', { name: 'Process list' }).click();
  await page.getByRole('button', { name: /Second task \d+ steps?/ }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('textbox', { name: 'New step name', exact: true }).fill('Task B pending');
  const keyB = scopedKey(first.user, first.projectId, first.secondTask);
  await expect.poll(async () => (await readRecoveryRecord(page, keyB))?.name).toBe('Task B pending');
  await page.getByRole('button', { name: 'Process list' }).click();
  await page.getByRole('button', { name: /Recovery task \d+ steps?/ }).click();
  await expect(page.getByRole('textbox', { name: 'New step name', exact: true })).toHaveValue('Task A pending');
  // Give the same account explicit access to the independently seeded second product.
  await db.query(`insert into workspace_members(workspace_id,user_id,role) select workspace_id,$1,'editor' from workspace_members where user_id=$2 on conflict(workspace_id,user_id) do nothing`, [first.user, second.user]);
  await db.query("insert into project_access(project_id,user_id,level) values($1,$2,'edit') on conflict(project_id,user_id) do update set level='edit'", [second.projectId, first.user]);
  const other = await openDraft(page, second.projectId); await other.fill('Product Y pending');
  await expect.poll(async () => (await readRecoveryRecord(page, scopedKey(first.user, second.projectId, second.taskId)))?.name).toBe('Product Y pending');
  expect((await readRecoveryRecord(page, keyA))?.name).toBe('Task A pending');
  expect((await readRecoveryRecord(page, keyB))?.name).toBe('Task B pending');
  await page.goto(`/projects/${first.projectId}/mobile-photos`);
  await expect(page.getByRole('textbox', { name: 'New step name', exact: true })).toHaveValue('Task A pending');
});

test('two accounts sharing one browser profile retain separate recovery records', async ({ context, page }) => {
  const own = await fixture(); await signIn(context, own.email); await blockStepWrites(page);
  const name = await openDraft(page, own.projectId); await name.fill('User one pending');
  const keyOne = scopedKey(own.user, own.projectId, own.taskId);
  await expect.poll(async () => (await readRecoveryRecord(page, keyOne))?.name).toBe('User one pending');
  const original = await readRecoveryRecord(page, keyOne);
  await signIn(context, own.otherEmail); await page.reload();
  await page.getByRole('button', { name: /Recovery task \d+ steps?/ }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  const other = page.getByRole('textbox', { name: 'New step name', exact: true });
  await expect(other).toHaveValue(''); await other.fill('User two pending');
  await expect.poll(async () => (await readRecoveryRecord(page, scopedKey(own.otherUser, own.projectId, own.taskId)))?.name).toBe('User two pending');
  expect(await readRecoveryRecord(page, keyOne)).toEqual(original);
  await signIn(context, own.email); await page.reload();
  await expect(page.getByRole('textbox', { name: 'New step name', exact: true })).toHaveValue('User one pending');
});

test('one tab acknowledging its old token leaves the other tab draft intact', async ({ context, page }) => {
  const own = await fixture(); await signIn(context, own.email);
  let blocked = true;
  await page.route('**/rest/v1/manufacturing_steps*', async (route) => {
    if (blocked && route.request().method() !== 'GET') await route.abort(); else await route.continue();
  });
  const name = await openDraft(page, own.projectId); await name.fill('Tab one');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  const key = scopedKey(own.user, own.projectId, own.taskId);
  const first = await readRecoveryRecord(page, key);
  const other = await context.newPage(); await blockStepWrites(other);
  await other.goto(`/projects/${own.projectId}/mobile-photos`);
  const otherName = other.getByRole('textbox', { name: 'New step name', exact: true });
  await expect(otherName).toHaveValue('Tab one');
  await expect(other.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await otherName.fill('Tab two newer');
  await expect.poll(async () => (await readRecoveryRecord(other, key))?.name).toBe('Tab two newer');
  const newer = await readRecoveryRecord(other, key); expect(newer?.writeToken).not.toBe(first?.writeToken);
  blocked = false; await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await readRecoveryRecord(other, key)).toEqual(newer);
  await other.close();
});

test('legacy review is read-only; explicit adoption preserves original and repeating it does not duplicate the step', async ({ context, page }) => {
  const f = await fixture(); await signIn(context, f.email);
  await page.goto(`/projects/${f.projectId}/mobile-photos`);
  const legacy = { key: 'mobile-new-step-draft-v1', taskId: f.taskId, stepId: `legacy-${randomUUID()}`, name: 'Legacy bracket', instruction: 'Recognized earlier work', durationText: '5', tools: [], photos: [], checks: [], checkValues: {}, updatedAt: new Date().toISOString() };
  await page.evaluate(([databaseName, storeName, record]) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(databaseName, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(storeName, { keyPath: 'key' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const database = open.result; const tx = database.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(record); tx.oncomplete = () => { database.close(); resolve(); }; tx.onerror = () => { database.close(); reject(tx.error); }; };
  }), [DB_NAME, STORE, legacy] as const);
  await page.reload();
  await page.getByRole('button', { name: /Recovery task \d+ steps?/ }).click();
  await page.getByRole('button', { name: 'Review saved draft', exact: true }).click();
  await expect(page.getByText('Recognized earlier work', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  expect((await db.query('select count(*) from manufacturing_steps where id=$1', [legacy.stepId])).rows[0].count).toBe('0');
  expect(await readRecoveryRecord(page, legacy.key)).toEqual(legacy);
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  expect(await readRecoveryRecord(page, legacy.key)).toEqual(legacy);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.reload();
    if (await page.getByRole('button', { name: /Recovery task \d+ steps?/ }).isVisible()) await page.getByRole('button', { name: /Recovery task \d+ steps?/ }).click();
    await page.getByRole('button', { name: 'Review saved draft', exact: true }).click();
    if (attempt > 0) {
      await expect(page.getByRole('button', { name: 'Use this draft', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Use this draft', exact: true }).click();
    await expect.poll(async () => (await db.query('select name from manufacturing_steps where id=$1', [legacy.stepId])).rows[0]?.name).toBe('Legacy bracket');
    await expect.poll(() => readRecoveryRecord(page, scopedKey(f.user, f.projectId, f.taskId))).toBeNull();
    expect(await readRecoveryRecord(page, legacy.key)).toEqual(legacy);
    expect((await db.query('select count(*) from manufacturing_steps where task_id=$1', [f.taskId])).rows[0].count).toBe('1');
  }
});

test('immediate reload characterizes local commit without a durability promise', async ({ context, page }, testInfo) => {
  const f = await fixture(); await signIn(context, f.email); await blockStepWrites(page);
  const observations: boolean[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const input = await openDraft(page, f.projectId);
    const name = `Immediate reload ${attempt}`;
    await input.fill(name);
    // Deliberately no wait for storage, save status or a database outcome before teardown.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Process list', exact: true })).toBeVisible();
    const record = await readRecoveryRecord(page, scopedKey(f.user, f.projectId, f.taskId));
    observations.push(record?.name === name);
  }
  await testInfo.attach('immediate-reload-observations', { body: JSON.stringify({ recovered: observations.filter(Boolean).length, attempts: observations.length, observations }), contentType: 'application/json' });
});

test('competing tab edits retain both drafts across reload and acknowledgment', async ({ context, page }) => {
  const f = await fixture(); await signIn(context, f.email);
  let blocked = true;
  await page.route('**/rest/v1/manufacturing_steps*', async route => {
    if (blocked && route.request().method() !== 'GET') await route.abort(); else await route.continue();
  });
  const key = scopedKey(f.user, f.projectId, f.taskId);
  const first = await openDraft(page, f.projectId);
  await first.fill('Shared baseline');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  const other = await context.newPage(); await blockStepWrites(other);
  await other.goto(`/projects/${f.projectId}/mobile-photos`);
  const second = other.getByRole('textbox', { name: 'New step name', exact: true });
  await expect(second).toHaveValue('Shared baseline');
  await first.fill('First tab unsaved');
  await expect.poll(async () => (await readRecoveryRecord(page, key))?.name).toBe('First tab unsaved');
  await second.fill('Second tab unsaved');
  await expect(other.getByRole('button', { name: 'Retry save' })).toBeVisible();
  const affinity = await other.evaluate(key => sessionStorage.getItem(`pulse:recovery-selection:${key}`), key);
  expect(affinity).toMatch(new RegExp(`^${key}:fork:`));
  await expect.poll(async () => (await readRecoveryRecord(other, affinity!))?.name).toBe('Second tab unsaved');
  expect((await readRecoveryRecord(page, key))?.name).toBe('First tab unsaved');
  await page.reload(); await other.reload();
  await expect(page.getByRole('textbox', { name: 'New step name', exact: true })).toHaveValue('First tab unsaved');
  await expect(second).toHaveValue('Second tab unsaved');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  blocked = false; await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(await readRecoveryRecord(page, key)).toBeNull();
  expect((await readRecoveryRecord(other, affinity!))?.name).toBe('Second tab unsaved');
  await other.close();
});
