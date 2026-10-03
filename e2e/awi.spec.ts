import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const api = 'http://127.0.0.1:56321';
const password = 'Browser-test-Password-42!';
const db = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' });
const admin = createClient(api, process.env.E2E_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let workspace: string;
let user: string;
let email: string;
let pageErrors: string[];

async function authenticate(context: BrowserContext) {
  const client = createServerClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [],
      setAll: async (cookies) => {
        await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const })));
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
async function createDraft(page: Page, number = '') {
  await page.goto(`/awi?workspace=${workspace}`);
  await page.getByRole('button', { name: 'Add AWI', exact: true }).click();
  await page.getByLabel('Instruction title').fill('Shared bracket installation');
  if (number) await page.getByLabel('Document number', { exact: true }).fill(number);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/awi\/[a-f0-9-]+\?/);
  await expect(page.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toBeEditable();
  await saved(page);
  await expect(page.getByRole('button', { name: 'Publish AWI', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'AWI list', exact: true })).toHaveCount(0);
  await expect(page.getByText('Unzoned', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Zone', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Operators', { exact: true })).toHaveCount(0);
  return page.url();
}
async function edit(page: Page, instruction: string) {
  await page.getByRole('textbox', { name: 'Step 1 name', exact: true }).fill('Install bracket');
  await page.getByRole('textbox', { name: 'Step 1 instruction', exact: true }).fill(instruction);
  await page.getByRole('textbox', { name: 'Step 1 instruction', exact: true }).blur();
  // Check durable database content as well as the status, avoiding a stale Saved label.
  await expect.poll(async () => (await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe(instruction);
  await saved(page);
}

test.beforeEach(async ({ context, page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  workspace = `ws-browser-${randomUUID()}`;
  email = `author-${randomUUID()}@awi-browser.test`;
  await db.query('insert into workspaces(id,name) values($1,$2)', [workspace, 'Browser test organization']);
  await db.query('insert into workspace_auto_join_domains(domain,workspace_id) values($1,$2) on conflict(domain) do update set workspace_id=excluded.workspace_id', ['awi-browser.test', workspace]);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Browser Test Author' } });
  if (error) throw error;
  user = data.user.id;
  await db.query('insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3) on conflict(workspace_id,user_id) do update set role=excluded.role', [workspace, user, 'editor']);
  await authenticate(context);
});
test.afterEach(() => { expect(pageErrors, 'Uncaught browser errors').toEqual([]); });
test.afterAll(async () => { await db.end(); });

test('creates a numbered draft and recovers saved content in a fresh browser', async ({ page, browser }) => {
  const url = await createDraft(page);
  await page.getByRole('button', { name: 'Edit AWI name', exact: true }).click();
  await page.getByRole('textbox', { name: 'AWI name', exact: true }).fill('Shared mounting instruction');
  await page.getByRole('textbox', { name: 'AWI name', exact: true }).press('Enter');
  await expect.poll(async () => (await db.query('select title,document_number from awi_masters where workspace_id=$1', [workspace])).rows[0]).toEqual({ title: 'Shared mounting instruction', document_number: 'AWI-0001' });
  await expect(page.getByRole('button', { name: 'Edit AWI name', exact: true })).toContainText('Shared mounting instruction');
  const instruction = 'Fit the bracket and secure both mounting bolts.';
  await edit(page, instruction);
  await page.getByRole('link', { name: 'AWI Master List', exact: true }).click();
  const row = page.getByRole('link').filter({ hasText: 'Shared mounting instruction' });
  await expect(row).toContainText('AWI-0001');
  await expect(row).toContainText('Draft');
  await row.click();
  await expect(page.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveValue(instruction);
  // New context has no planner cache, localStorage, or existing browser cookies.
  const fresh = await browser.newContext();
  try {
    await authenticate(fresh);
    const reopened = await fresh.newPage();
    reopened.on('pageerror', (error) => pageErrors.push(error.message));
    await reopened.goto(url);
    await expect(reopened.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveValue(instruction);
    await expect(reopened.getByRole('textbox', { name: 'Step 1 name', exact: true })).toHaveValue('Install bracket');
    await expect(reopened.getByRole('button', { name: 'Edit AWI name', exact: true })).toContainText('Shared mounting instruction');
    await saved(reopened);
  } finally { await fresh.close(); }
});

test('publishes a fixed revision and keeps later edits as draft changes', async ({ page }) => {
  const url = await createDraft(page, 'AWI-BROWSER-RELEASE');
  const original = 'Install the bracket and verify fastener seating.';
  await edit(page, original);
  // Supply required readiness data through the actual builder controls.
  await page.getByRole('combobox', { name: /tool for step 1/i }).fill('Torque wrench');
  await page.getByRole('combobox', { name: /tool for step 1/i }).press('Enter');
  await page.getByRole('group', { name: 'Step 1 checks', exact: true }).getByRole('checkbox').first().check();
  await saved(page);
  await page.getByRole('button', { name: 'Work Instructions', exact: true }).click();
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^3.*Release$/ }).click();
  await page.getByLabel('What changed in this revision').fill('Initial release');
  await page.getByRole('button', { name: 'Release Rev A', exact: true }).click();
  await page.getByRole('dialog', { name: 'Release Rev A?', exact: true }).getByRole('button', { name: 'Release Rev A', exact: true }).click();
  await expect(page.getByText('Released as Rev A.', { exact: true })).toBeVisible();
  const release = (await db.query('select r.id,r.content,r.content_hash from work_instruction_releases r join awi_masters m on m.published_release_id=r.id where m.workspace_id=$1', [workspace])).rows[0];
  expect(release).toBeTruthy();
  expect(JSON.stringify(release.content)).toContain(original);
  await page.getByRole('button', { name: 'Close document control' }).click();
  await page.getByRole('button', { name: 'Procedure', exact: true }).click();
  await edit(page, 'Updated draft: inspect the bracket before installation.');
  await page.getByRole('link', { name: 'AWI Master List', exact: true }).click();
  await expect(page.getByRole('link').filter({ hasText: 'Shared bracket installation' })).toContainText('Published · draft changes');
  const frozen = (await db.query('select content,content_hash from work_instruction_releases where id=$1', [release.id])).rows[0];
  expect(frozen.content).toEqual(release.content);
  expect(frozen.content_hash).toBe(release.content_hash);
  await page.goto(url);
  await expect(page.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveValue('Updated draft: inspect the bracket before installation.');
});

test('failed revision reads block release and allow a safe retry', async ({ page }) => {
  await createDraft(page);
  await page.route('**/rest/v1/work_instruction_releases?*', (route) => route.abort());
  await page.getByRole('button', { name: 'Work Instructions', exact: true }).click();
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to load revision history' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeEnabled();
  await page.unroute('**/rest/v1/work_instruction_releases?*');
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Escape and blank names preserve the existing AWI identity', async ({ page }) => {
  await createDraft(page);
  await page.getByRole('button', { name: 'Edit AWI name', exact: true }).click();
  await page.getByRole('textbox', { name: 'AWI name', exact: true }).fill('Cancelled name');
  await page.getByRole('textbox', { name: 'AWI name', exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Edit AWI name', exact: true })).toContainText('Shared bracket installation');
  await page.getByRole('button', { name: 'Edit AWI name', exact: true }).click();
  await page.getByRole('textbox', { name: 'AWI name', exact: true }).fill('   ');
  await page.getByRole('textbox', { name: 'AWI name', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Edit AWI name', exact: true })).toContainText('Shared bracket installation');
  await saved(page);
  expect((await db.query('select title,document_number from awi_masters where workspace_id=$1', [workspace])).rows[0]).toEqual({ title: 'Shared bracket installation', document_number: 'AWI-0001' });
});

test('failed saves retain the local draft and retry one complete transaction', async ({ page }) => {
  await createDraft(page);
  const before = (await db.query('select s.name,s.instruction,s.version from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows;
  let attempts = 0;
  await page.route('**/rest/v1/rpc/save_awi_procedure', async (route) => {
    attempts += 1;
    await route.abort();
  });
  const input = page.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
  await page.getByRole('textbox', { name: 'Step 1 name', exact: true }).fill('Recovered step');
  await input.fill('Recover this complete instruction after a connection failure.');
  await input.blur();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.getByRole('status').filter({ hasText: /Save pending/ })).toBeVisible();
  await expect(input).toHaveValue('Recover this complete instruction after a connection failure.');
  expect((await db.query('select s.name,s.instruction,s.version from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows).toEqual(before);
  await page.unroute('**/rest/v1/rpc/save_awi_procedure');
  await expect.poll(async () => (await db.query('select s.name,s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]).toEqual({
    name: 'Recovered step', instruction: 'Recover this complete instruction after a connection failure.',
  });
  await saved(page);
  await page.reload();
  await expect(input).toHaveValue('Recover this complete instruction after a connection failure.');
});

test('a competing step edit is preserved while the local draft reports a conflict', async ({ page, browser }) => {
  const url = await createDraft(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  await page.route('**/rest/v1/rpc/save_awi_procedure', async (route) => {
    started = true;
    await held;
    await route.continue();
  });
  const input = page.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
  await input.fill('Local draft still needs review.');
  await input.blur();
  await expect.poll(() => started).toBe(true);
  await db.query('update manufacturing_steps set instruction=$1 where task_id=(select task_id from awi_masters where workspace_id=$2)', ['Other device saved instruction.', workspace]);
  release();
  await expect(page.getByRole('status').filter({ hasText: /Save pending/ })).toBeVisible();
  await expect(page.getByText(/AWI save conflict\. Your local draft is preserved/).first()).toBeVisible();
  await expect(input).toHaveValue('Local draft still needs review.');
  expect((await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe('Other device saved instruction.');
  const fresh = await browser.newContext();
  try {
    await authenticate(fresh);
    const reopened = await fresh.newPage();
    await reopened.goto(url);
    await expect(reopened.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveValue('Other device saved instruction.');
  } finally { await fresh.close(); }
});

test('newer edits queued during a save use its confirmed baseline', async ({ page }) => {
  await createDraft(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route('**/rest/v1/rpc/save_awi_procedure', async (route) => {
    attempts += 1;
    if (attempts === 1) await held;
    await route.continue();
  });
  const input = page.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
  await input.fill('First edit sent.');
  await input.blur();
  await expect.poll(() => attempts).toBe(1);
  await input.fill('Newer edit queued while the first save runs.');
  await input.blur();
  release();
  await expect.poll(async () => (await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe('Newer edit queued while the first save runs.');
  await saved(page);
  expect(attempts).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(input).toHaveValue('Newer edit queued while the first save runs.');
});
