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
const KEY = 'mobile-new-step-draft-v1';

function readRecoveryRecord(page: Page) {
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
  }), [DB_NAME, STORE, KEY] as const);
}

test('recovery draft: save, overwrite, survive reload, clear once the step is saved', async ({ context, page }) => {
  const workspace = `ws-recovery-${randomUUID()}`;
  const email = `recovery-${randomUUID()}@recovery.test`;
  await db.query('insert into workspaces(id,name) values($1,$2)', [workspace, 'Recovery org']);
  await db.query('insert into workspace_auto_join_domains(domain,workspace_id) values($1,$2) on conflict(domain) do update set workspace_id=excluded.workspace_id', ['recovery.test', workspace]);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Recovery Tester' } });
  if (error) throw error;
  const user = data.user.id;
  await db.query('insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3) on conflict(workspace_id,user_id) do update set role=excluded.role', [workspace, user, 'editor']);
  const auth = createServerClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => [], setAll: async (cookies) => { await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const }))); } } });
  const signIn = await auth.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
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

  // Block step writes so the draft cannot complete and the recovery record stays in IndexedDB.
  let blocked = true;
  await page.route('**/rest/v1/manufacturing_steps*', async (route) => {
    if (blocked && route.request().method() !== 'GET') await route.abort();
    else await route.continue();
  });

  await page.goto(`/projects/${projectId}/mobile-photos`);
  await page.getByRole('button', { name: /Recovery task 0 steps/ }).click();
  await page.getByRole('button', { name: 'Add step' }).click();
  const name = page.getByRole('textbox', { name: 'New step name', exact: true });
  await name.fill('Draft one');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();

  // save
  const first = (await readRecoveryRecord(page))!;
  expect(first).toMatchObject({ key: KEY, taskId, name: 'Draft one', instruction: '', durationText: '5', tools: [], photos: [], checks: [] });
  expect(typeof first.stepId).toBe('string');
  expect(new Date(first.updatedAt as string).toISOString()).toBe(first.updatedAt);

  // overwrite
  await name.fill('Draft one two');
  await expect.poll(async () => (await readRecoveryRecord(page))?.name).toBe('Draft one two');
  const second = (await readRecoveryRecord(page))!;
  expect(second.stepId).toBe(first.stepId);
  expect(Date.parse(second.updatedAt as string)).toBeGreaterThanOrEqual(Date.parse(first.updatedAt as string));

  // reload / read: the draft is restored from IndexedDB and re-saved (still blocked, so it stays)
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'New step name', exact: true })).toHaveValue('Draft one two');
  await expect(page.getByText(/Recovered an unsaved phone draft/)).toBeVisible();
  expect((await readRecoveryRecord(page))?.name).toBe('Draft one two');
  expect((await db.query('select count(*)::int n from manufacturing_steps where task_id=$1', [taskId])).rows[0].n).toBe(0);

  // clear: once the step actually saves, the record goes away
  blocked = false;
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await expect.poll(async () => (await db.query('select name from manufacturing_steps where task_id=$1', [taskId])).rows.map((row) => row.name)).toEqual(['Draft one two']);
  await expect.poll(() => readRecoveryRecord(page)).toBeNull();
});
