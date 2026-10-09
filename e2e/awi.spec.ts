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

async function authenticate(context: BrowserContext, signInEmail = email) {
  const client = createServerClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [],
      setAll: async (cookies) => {
        await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const })));
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: signInEmail, password });
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
async function releaseReadiness(page: Page) {
  // Cached AWI content can be visible while fresh core/access confirmation
  // keeps its ancestor inert. Playwright fill/press does not wait for that gate.
  await expect.poll(() => page.getByRole('combobox', { name: /tool for step 1/i })
    .evaluate((element) => element.closest('[inert]') === null)).toBe(true);
  await saved(page);
  await page.getByRole('combobox', { name: /tool for step 1/i }).fill('Torque wrench');
  await expect(page.getByRole('combobox', { name: /tool for step 1/i })).toHaveValue('Torque wrench');
  await page.getByRole('combobox', { name: /tool for step 1/i }).press('Enter');
  // The tool write and debounced check save have separate completion paths.
  // Confirm both durable records before closing the authoring browser.
  await expect.poll(async () => (await db.query('select t.tool_name from step_tools t join awi_masters m on m.task_id=t.task_id where m.workspace_id=$1', [workspace])).rows.map((row) => row.tool_name)).toContain('Torque Wrench');
  await page.getByRole('group', { name: 'Step 1 checks', exact: true }).getByRole('checkbox').first().check();
  await expect.poll(async () => (await db.query('select s.quality_check from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.quality_check).toBeTruthy();
  await saved(page);
}

for (const first of ['tool', 'procedure'] as const) {
  test(`save status waits for both writes when ${first} finishes first`, async ({ page }) => {
    await createDraft(page);
    let releaseTool!: () => void;
    let releaseProcedure!: () => void;
    const toolGate = new Promise<void>((resolve) => { releaseTool = resolve; });
    const procedureGate = new Promise<void>((resolve) => { releaseProcedure = resolve; });
    let toolStarted = false;
    let procedureStarted = false;
    await page.route('**/rest/v1/step_tools*', async (route) => {
      if (route.request().method() === 'POST') { toolStarted = true; await toolGate; }
      await route.continue();
    });
    await page.route('**/rest/v1/rpc/save_awi_procedure', async (route) => {
      procedureStarted = true;
      await procedureGate;
      await route.continue();
    });
    try {
      await page.getByRole('combobox', { name: /tool for step 1/i }).fill('Torque wrench');
      await page.getByRole('combobox', { name: /tool for step 1/i }).press('Enter');
      await expect.poll(() => toolStarted).toBe(true);
      await page.getByRole('textbox', { name: 'Step 1 instruction', exact: true }).fill('Keep the save status pending until both writes finish.');
      await page.getByRole('textbox', { name: 'Step 1 instruction', exact: true }).blur();
      await expect.poll(() => procedureStarted).toBe(true);
      if (first === 'tool') {
        releaseTool();
        await expect.poll(async () => (await db.query('select count(*)::int n from step_tools t join awi_masters m on m.task_id=t.task_id where m.workspace_id=$1', [workspace])).rows[0].n).toBe(1);
      } else {
        releaseProcedure();
        await expect.poll(async () => (await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe('Keep the save status pending until both writes finish.');
      }
      await expect(page.getByRole('status').filter({ hasText: /^Saving…$/ })).toBeVisible();
      await page.getByRole('link', { name: 'AWI Master List', exact: true }).click();
      await expect(page).toHaveURL(/\/awi\/[a-f0-9-]+\?/);
      releaseTool();
      releaseProcedure();
      await saved(page);
      expect((await db.query('select count(*)::int n from step_tools t join awi_masters m on m.task_id=t.task_id where m.workspace_id=$1', [workspace])).rows[0].n).toBe(1);
      expect((await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe('Keep the save status pending until both writes finish.');
    } finally { releaseTool(); releaseProcedure(); }
  });
}

test('an unrelated successful procedure save does not hide a failed tool write', async ({ page }) => {
  await createDraft(page);
  await page.route('**/rest/v1/step_tools*', async (route) => {
    if (route.request().method() === 'POST') await route.abort();
    else await route.continue();
  });
  await page.getByRole('combobox', { name: /tool for step 1/i }).fill('Torque wrench');
  await page.getByRole('combobox', { name: /tool for step 1/i }).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: /^Save pending/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Step 1 instruction', exact: true }).fill('This saved instruction cannot confirm the failed tool write.');
  await page.getByRole('textbox', { name: 'Step 1 instruction', exact: true }).blur();
  await expect.poll(async () => (await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe('This saved instruction cannot confirm the failed tool write.');
  await expect(page.getByRole('status').filter({ hasText: /^Save pending/ })).toBeVisible();
  expect((await db.query('select count(*)::int n from step_tools t join awi_masters m on m.task_id=t.task_id where m.workspace_id=$1', [workspace])).rows[0].n).toBe(0);
  await page.getByRole('link', { name: 'AWI Master List', exact: true }).click();
  await expect(page).toHaveURL(/\/awi\/[a-f0-9-]+\?/);
  // Use the existing controls to replace the failed assignment with a confirmed one.
  await page.unroute('**/rest/v1/step_tools*');
  await page.getByRole('button', { name: 'Remove Torque Wrench from step 1', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove Tool', exact: true }).click();
  await saved(page);
  await page.getByRole('combobox', { name: /tool for step 1/i }).fill('Torque wrench');
  await page.getByRole('combobox', { name: /tool for step 1/i }).press('Enter');
  await saved(page);
  expect((await db.query('select count(*)::int n from step_tools t join awi_masters m on m.task_id=t.task_id where m.workspace_id=$1', [workspace])).rows[0].n).toBe(1);
});

test('immediately drained newer edits do not replay an obsolete save timer', async ({ page }) => {
  await createDraft(page);
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let attempts = 0;
  await page.route('**/rest/v1/rpc/save_awi_procedure', async (route) => {
    attempts += 1;
    if (attempts === 1) await firstGate;
    await route.continue();
  });
  try {
    const instruction = page.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
    await instruction.fill('First edit held at the server.');
    await instruction.blur();
    await expect.poll(() => attempts).toBe(1);
    await instruction.fill('Newer edit must remain the final confirmed content.');
    await instruction.blur();
    releaseFirst();
    await expect.poll(async () => (await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe('Newer edit must remain the final confirmed content.');
    await saved(page);
    // Observe beyond the debounce window: a stale timer would issue a third
    // transaction after Saved and turn a successful edit into a conflict.
    await page.waitForTimeout(1100);
    expect(attempts).toBe(2);
    await saved(page);
  } finally { releaseFirst(); }
});

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
  await db.query("insert into product_module_access(workspace_id,user_id,level) values($1,$2,'edit')", [workspace, user]);
  await authenticate(context);
});
test.afterEach(() => { expect(pageErrors, 'Uncaught browser errors').toEqual([]); });
test.afterAll(async () => { await db.end(); });

test('a failed BOM replacement can retry without reloading or losing the confirmed BOM', async ({ page }) => {
  const connection = await db.connect();
  let productId: string;
  try {
    await connection.query('begin');
    await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await connection.query('set local role authenticated');
    productId = (await connection.query('select public.create_project_with_starter_plan($1,$2) id', [workspace, 'BOM recovery product'])).rows[0].id;
    await connection.query('commit');
  } catch (error) { await connection.query('rollback'); throw error; }
  finally { connection.release(); }
  await page.goto(`/projects/${productId}/planner?view=setup`);
  await page.getByRole('button', { name: 'BOM', exact: true }).click();
  const upload = (name: string, part: string) => page.getByLabel('Master BOM file').setInputFiles({
    name, mimeType: 'text/csv', buffer: Buffer.from(`Part Number,Description\n${part},Bracket\n`),
  });
  await upload('confirmed.csv', 'OLD-1');
  await expect(page.getByText('OLD-1', { exact: true })).toBeVisible();
  const readBom = async () => (await db.query('select custom_fields from products where project_id=$1', [productId])).rows[0].custom_fields;
  const confirmed = await readBom();
  let replacementAttempts = 0;
  await page.route('**/rest/v1/products*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    replacementAttempts += 1;
    if (replacementAttempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'BOM recovery test outage' }) });
    await route.continue();
  });
  await upload('replacement.csv', 'NEW-2');
  await page.getByRole('dialog', { name: 'Replace master BOM?', exact: true }).getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'BOM recovery test outage' })).toBeVisible();
  await expect(page.getByText('OLD-1', { exact: true })).toBeVisible();
  expect(await readBom()).toEqual(confirmed);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('NEW-2', { exact: true })).toBeVisible();
  expect(replacementAttempts).toBe(2);
  expect(JSON.stringify(await readBom())).toContain('NEW-2');
  await page.reload();
  await page.getByRole('button', { name: 'BOM', exact: true }).click();
  await expect(page.getByText('NEW-2', { exact: true })).toBeVisible();
});

for (const kind of ['video', 'exploded view'] as const) {
  test(`failed ${kind} deletion restores its retry control and preserves concurrent edits`, async ({ page }) => {
    const url = await createDraft(page);
    const taskId = (await db.query('select task_id from awi_masters where workspace_id=$1', [workspace])).rows[0].task_id;
    const mediaId = randomUUID();
    const table = kind === 'video' ? 'task_videos' : 'step_exploded_views';
    const name = `Recovery ${kind}`;
    // New isolated fixtures only; an absent storage object exercises gallery placeholders.
    await db.query(`insert into ${table}(id,task_id,storage_path,public_url,file_name) values($1,$2,$3,$4,$5)`, [mediaId, taskId, `browser-recovery/${mediaId}`, '', name]);
    await page.goto(url);
    const remove = page.getByRole('button', { name: `Delete ${name}`, exact: true });
    await expect(remove).toBeVisible();
    let releaseFailure!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFailure = resolve; });
    let attempts = 0;
    await page.route(`**/rest/v1/${table}*`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      attempts += 1;
      if (attempts === 1) {
        await gate;
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Media recovery test outage' }) });
      }
      await route.continue();
    });
    const confirmDelete = () => page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    try {
      await remove.click();
      await confirmDelete();
      await expect.poll(() => attempts).toBe(1);
      await expect(remove).toHaveCount(0);
      const instruction = page.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
      await instruction.fill('Instruction edited while the media request was pending.');
      await instruction.blur();
      await expect.poll(async () => (await db.query('select instruction from manufacturing_steps where task_id=$1', [taskId])).rows[0].instruction).toBe('Instruction edited while the media request was pending.');
      releaseFailure();
      await expect(remove).toBeVisible();
      await expect(instruction).toHaveValue('Instruction edited while the media request was pending.');
      expect((await db.query(`select deleted_at from ${table} where id=$1`, [mediaId])).rows[0].deleted_at).toBeNull();
      await remove.click();
      await confirmDelete();
      await expect.poll(async () => (await db.query(`select deleted_at from ${table} where id=$1`, [mediaId])).rows[0].deleted_at).not.toBeNull();
      await saved(page);
      await expect(remove).toHaveCount(0);
      expect(attempts).toBe(2);
      await page.getByRole('link', { name: 'AWI Master List', exact: true }).click();
      await expect(page).toHaveURL(/\/awi\?workspace=/);
    } finally { releaseFailure(); }
  });
}

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
  await releaseReadiness(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
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
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to load revision history' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.unroute('**/rest/v1/work_instruction_releases?*');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
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

test('a product save held across a sidebar product switch stays in its product and leaves the next product usable', async ({ page }) => {
  async function createProduct(name: string, instruction: string) {
    const connection = await db.connect();
    let projectId: string;
    try {
      await connection.query('begin');
      await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      await connection.query('set local role authenticated');
      projectId = (await connection.query('select public.create_project_with_starter_plan($1,$2) id', [workspace, name])).rows[0].id;
      await connection.query('commit');
    } catch (error) { await connection.query('rollback'); throw error; }
    finally { connection.release(); }
    const scenario = (await db.query('select s.id from scenarios s join products p on p.id=s.product_id where p.project_id=$1', [projectId])).rows[0].id;
    const taskId = `switch-task-${randomUUID()}`;
    const stepId = `switch-step-${randomUUID()}`;
    await db.query(`insert into tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators) values($1,$2,$3,'1',now(),now(),0,1)`, [taskId, scenario, `${name} task`]);
    await db.query(`insert into manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values($1,$2,1,'Install',$3,0)`, [stepId, taskId, instruction]);
    return { projectId, taskId, stepId };
  }
  const instructionOf = async (stepId: string) =>
    (await db.query('select instruction from manufacturing_steps where id=$1', [stepId])).rows[0]?.instruction;
  const productA = await createProduct('Switch product A', 'Product A original step.');
  const productB = await createProduct('Switch product B', 'Product B original step.');
  const edit = 'Product A edit typed just before switching products.';

  // Hold product A's first procedure write; later attempts (the retry) pass through.
  let releaseFirst: (outcome: 'fail' | 'continue') => void = () => undefined;
  let attempts = 0;
  const firstHeld = new Promise<void>((held) => {
    void page.route(`${api}/rest/v1/tasks**`, async (route) => {
      const request = route.request();
      if (request.method() !== 'PATCH' || !request.url().includes(productA.taskId)) return route.continue();
      attempts += 1;
      if (attempts > 1) return route.continue();
      held();
      const outcome = await new Promise<'fail' | 'continue'>((resolve) => { releaseFirst = resolve; });
      return outcome === 'fail' ? route.abort('failed') : route.continue();
    });
  });

  try {
    await page.goto(`/projects/${productA.projectId}/planner?view=procedure&task=${productA.taskId}`);
    const instruction = page.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
    await expect.poll(() => instruction.evaluate((element) => element.closest('[inert]') === null)).toBe(true);
    await expect(instruction).toBeEditable();
    await instruction.fill(edit);
    await firstHeld;

    // A real sidebar switch (a button, so the in-app link guard does not apply) while A's save is held.
    await page.getByRole('button', { name: 'Switch product B', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${productB.projectId}/planner`));
    await expect(page.getByText('Line readiness', { exact: true })).toBeVisible();

    // A's held save now fails while B is on screen; A retries its own snapshot against A.
    releaseFirst('fail');
    await expect.poll(() => instructionOf(productA.stepId), { timeout: 20_000 }).toBe(edit);
    expect(attempts).toBe(2);
    expect(await instructionOf(productB.stepId)).toBe('Product B original step.');

    // B is not held by A's queue: an in-app link navigates without the unsaved-changes guard.
    await expect(page.getByText(/Wait for Saved before leaving|Resolve the save error before leaving/)).toHaveCount(0);
    await page.getByRole('link', { name: 'AWI Master List', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AWI Master List', exact: true })).toBeVisible();

    // Back in A, the confirmed edit is what A shows.
    await page.goto(`/projects/${productA.projectId}/planner?view=procedure&task=${productA.taskId}`);
    await expect(page.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveValue(edit);
    expect(attempts).toBe(2);
  } finally { releaseFirst('continue'); }
});

test('AWI and product navigation avoids duplicate workspace read bursts', async ({ page }) => {
  const connection = await db.connect();
  let productId: string;
  try {
    await connection.query('begin');
    await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await connection.query('set local role authenticated');
    productId = (await connection.query('select public.create_project_with_starter_plan($1,$2) id', [workspace, 'Navigation product'])).rows[0].id;
    await connection.query('commit');
  } catch (error) { await connection.query('rollback'); throw error; }
  finally { connection.release(); }
  await createDraft(page);
  const workspaceReads: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === api && request.method() === 'GET' &&
      /^\/rest\/v1\/(workspace_members|product_module_access|project_access|workspaces|projects)$/.test(url.pathname)) {
      workspaceReads.push(url.pathname);
    }
  });
  const measurements: { path: string; reads: number; milliseconds: number }[] = [];
  async function measure(path: string, navigate: () => Promise<void>, ready: () => Promise<void>) {
    workspaceReads.length = 0;
    const start = Date.now();
    await navigate();
    await ready();
    const milliseconds = Date.now() - start;
    // Allow background revalidation to settle; count real reads, not only the first paint.
    await page.waitForTimeout(1500);
    measurements.push({ path, reads: workspaceReads.length, milliseconds });
  }
  const directory = () => expect(page.getByRole('heading', { name: 'AWI Master List', exact: true })).toBeVisible();
  const editor = async () => { await expect(page.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toBeEditable(); await saved(page); };
  const toList = () => page.getByRole('link', { name: 'AWI Master List', exact: true }).click();
  const toAwi = () => page.getByRole('link').filter({ hasText: 'Shared bracket installation' }).click();
  await measure('AWI → list', toList, directory);
  await measure('list → product', () => page.getByRole('button', { name: 'Navigation product', exact: true }).click(), async () => {
    await expect(page).toHaveURL(new RegExp(`/projects/${productId}/planner`));
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByText('Line readiness', { exact: true })).toBeVisible();
  });
  await measure('product → list', toList, directory);
  await measure('list → AWI', toAwi, editor);
  await measure('AWI → list again', toList, directory);
  await measure('list → AWI again', toAwi, editor);
  console.log('Navigation measurements:', JSON.stringify(measurements));
  // The previous implementation made 92 reads across this path. Allow timing
  // variation in streamed shells while preventing that repeated-load regression.
  expect(measurements.reduce((sum, item) => sum + item.reads, 0)).toBeLessThanOrEqual(72);
});

test('procedure media loads without downloading the task content again', async ({ page, browser }) => {
  const url = await createDraft(page);
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'bracket.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'),
  });
  await expect.poll(async () => (await db.query('select count(*)::int n from step_photos p join awi_masters m on m.task_id=p.task_id where m.workspace_id=$1', [workspace])).rows[0].n).toBe(1);
  await saved(page);
  const fixture = (await db.query('select m.task_id,p.id photo_id,p.step_id from awi_masters m join step_photos p on p.task_id=m.task_id where m.workspace_id=$1', [workspace])).rows[0];
  const annotations = { version: 2, items: [{ id: 'fixture-arrow', type: 'arrow', color: '#d71921', strokeWidth: 3, x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.8 }] };
  // A legacy row with embedded photo data exercises the redundant-fetch case.
  // These are newly created records in the isolated browser database only.
  await page.goto(`/awi?workspace=${workspace}`);
  await expect(page.getByRole('heading', { name: 'AWI Master List', exact: true })).toBeVisible();
  await db.query(`update tasks set description=$2,safety_notes=$3,custom_fields=custom_fields || $4::jsonb where id=$1`, [
    fixture.task_id, 'Detailed assembly scope. '.repeat(400), 'Use approved protective equipment. '.repeat(200),
    JSON.stringify({ stepPhotoAnnotations: { [fixture.photo_id]: annotations }, stepPhotoAttachments: { [fixture.step_id]: [{ id: fixture.photo_id, dataUrl: `data:image/png;base64,${'A'.repeat(256 * 1024)}` }] } }),
  ]);
  const measurements: { taskBytes: number; taskReads: number; readyMilliseconds: number }[] = [];
  for (let run = 0; run < 5; run++) {
    const fresh = await browser.newContext();
    try {
      await authenticate(fresh);
      const reopened = await fresh.newPage();
      reopened.on('pageerror', (error) => pageErrors.push(error.message));
      const reads: Promise<number>[] = [];
      const photoResponses: number[] = [];
      reopened.on('response', (response) => {
        const requestUrl = new URL(response.url());
        if (requestUrl.origin === api && requestUrl.pathname.startsWith('/storage/v1/object/sign/') &&
            response.request().method() === 'GET') photoResponses.push(response.status());
        if (requestUrl.origin === api && requestUrl.pathname === '/rest/v1/tasks' &&
            requestUrl.searchParams.get('id') === `eq.${fixture.task_id}` && response.request().method() === 'GET') {
          reads.push(response.body().then((body) => body.length));
        }
      });
      const start = Date.now();
      await reopened.goto(url);
      await expect(reopened.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toBeEditable();
      await expect(reopened.getByRole('img', { name: 'Step 1 photo', exact: true })).toBeVisible();
      await saved(reopened);
      const readyMilliseconds = Date.now() - start;
      await expect.poll(() => reads.length).toBe(1);
      const sizes = await Promise.all(reads);
      measurements.push({ taskBytes: sizes.reduce((sum, bytes) => sum + bytes, 0), taskReads: sizes.length, readyMilliseconds });
      await expect.poll(() => photoResponses.length).toBeGreaterThan(0);
      expect(photoResponses.every((status) => status === 200)).toBe(true);
      await expect(reopened.locator('[data-annotation-type="arrow"]')).toHaveCount(1);
      if (run === 4) {
        await edit(reopened, 'Saved after loading the annotated private photo.');
        // Exercise the cached-but-inert interval after reload deterministically.
        // This is after the opening measurement and does not affect its samples.
        await reopened.route('**/rest/v1/manufacturing_steps*', async (route) => {
          if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, 500));
          await route.continue();
        });
        await reopened.reload();
        await expect(reopened.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveValue('Saved after loading the annotated private photo.');
        await expect(reopened.getByRole('img', { name: 'Step 1 photo', exact: true })).toBeVisible();
        await expect(reopened.locator('[data-annotation-type="arrow"]')).toHaveCount(1);
        const fields = (await db.query('select custom_fields from tasks where id=$1', [fixture.task_id])).rows[0].custom_fields;
        expect(fields.stepPhotoAnnotations[fixture.photo_id]).toEqual(annotations);
        await releaseReadiness(reopened);
      }
    } finally { await fresh.close(); }
  }
  console.log('Procedure media measurements (decoded task JSON bytes):', JSON.stringify(measurements));
  expect(Math.max(...measurements.map((item) => item.taskBytes))).toBeLessThan(1024);
  // Open a fresh browser and publish through the current AWI builder control.
  // The release must freeze the same annotated photo after its lazy load.
  const fresh = await browser.newContext();
  try {
    await authenticate(fresh);
    const control = await fresh.newPage();
    control.on('pageerror', (error) => pageErrors.push(error.message));
    await control.goto(url);
    await saved(control);
    await control.getByRole('button', { name: 'Publish', exact: true }).click();
    await control.getByRole('dialog').getByRole('button', { name: /^3.*Release$/ }).click();
    await control.getByLabel('What changed in this revision').fill('Release with lazily loaded annotated photo');
    await control.getByRole('button', { name: 'Release Rev A', exact: true }).click();
    await control.getByRole('dialog', { name: 'Release Rev A?', exact: true }).getByRole('button', { name: 'Release Rev A', exact: true }).click();
    await expect(control.getByText('Released as Rev A.', { exact: true })).toBeVisible();
    const release = (await db.query('select r.content from work_instruction_releases r join awi_masters m on m.published_release_id=r.id where m.task_id=$1', [fixture.task_id])).rows[0];
    expect(JSON.stringify(release.content)).toContain('fixture-arrow');
    expect(JSON.stringify(release.content)).toContain('Saved after loading the annotated private photo.');
  } finally { await fresh.close(); }
});

test('AWI and product opening trace keeps access checks off a serial waterfall', async ({ page, browser }) => {
  const awiUrl = await createDraft(page);
  const connection = await db.connect();
  let projectId: string;
  try {
    await connection.query('begin');
    await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await connection.query('set local role authenticated');
    projectId = (await connection.query('select public.create_project_with_starter_plan($1,$2) id', [workspace, 'Opening trace product'])).rows[0].id;
    await connection.query('commit');
  } catch (error) { await connection.query('rollback'); throw error; }
  finally { connection.release(); }
  const scenario = (await db.query('select s.id from scenarios s join products p on p.id=s.product_id where p.project_id=$1', [projectId])).rows[0].id;
  const taskId = `trace-task-${randomUUID()}`;
  await db.query(`insert into tasks(id,scenario_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators) values($1,$2,'Trace assembly','1',now(),now(),0,1)`, [taskId, scenario]);
  await db.query(`insert into manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes) values($1,$2,1,'Install','Align the bracket.',0)`, [`trace-step-${randomUUID()}`, taskId]);
  const results: { screen: string; addedLatency: number; run: number; editableMilliseconds: number; browserTiming: unknown; reads: { path: string; scope: string; started: number; finished?: number }[] }[] = [];
  for (const [screen, url] of [['AWI', awiUrl], ['Product', `/projects/${projectId}/planner?view=procedure&task=${taskId}`], ['Dashboard', `/projects/${projectId}/planner?view=dashboard`]]) {
    for (const addedLatency of [0, 80]) {
      for (let run = 0; run < 5; run++) {
        const context = await browser.newContext();
        try {
          await authenticate(context);
          const opened = await context.newPage();
          opened.on('pageerror', (error) => pageErrors.push(error.message));
          // Record readiness in the page, avoiding assertion polling intervals
          // becoming part of the measured opening time.
          await opened.addInitScript((screen) => {
            const timings = { editableAt: 0 };
            Object.assign(window, { pulseOpeningTimings: timings });
            function check() {
              const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Step 1 instruction"]');
              const saved = screen !== "AWI" || Array.from(document.querySelectorAll('[role="status"]')).some((element) => element.textContent?.trim() === 'Saved');
              const dashboard = screen === "Dashboard" && Array.from(document.querySelectorAll('h2'))
                .some((element) => element.textContent === 'Line readiness' && element.checkVisibility());
              if (dashboard || (input && !input.disabled && !input.readOnly && !input.closest('[inert]') && input.checkVisibility() && saved)) {
                timings.editableAt = Date.now();
              } else requestAnimationFrame(check);
            }
            requestAnimationFrame(check);
          }, screen);
          const reads: { path: string; scope: string; started: number; finished?: number }[] = [];
          const started = new Map<object, typeof reads[number]>();
          let start = 0;
          await opened.route(`${api}/rest/v1/**`, async (route) => {
            const request = route.request();
            if (request.method() === 'GET' || new URL(request.url()).pathname.includes('/rpc/')) {
              if (addedLatency) await new Promise((resolve) => setTimeout(resolve, addedLatency));
            }
            await route.continue();
          });
          opened.on('request', (request) => {
            const target = new URL(request.url());
            if (target.origin === api && target.pathname.startsWith('/rest/v1/') &&
                (request.method() === 'GET' || target.pathname.includes('/rpc/'))) {
              const read = { path: target.pathname.replace('/rest/v1/', ''), scope: ['id', 'project_id', 'workspace_id', 'scenario_id', 'product_id', 'task_id'].find((key) => target.searchParams.has(key)) ?? '', started: Date.now() - start };
              reads.push(read); started.set(request, read);
            }
          });
          opened.on('response', (response) => {
            const read = started.get(response.request());
            if (read) read.finished = Date.now() - start;
          });
          start = Date.now();
          await opened.goto(url);
          if (screen === 'Dashboard') {
            await expect(opened.getByRole('heading', { name: 'Line readiness', exact: true })).toBeVisible();
            // Dashboard first paint can use the server summary. Still wait for
            // core reads before inspecting their overlap and JS transfer size.
            await expect.poll(() => reads.some((read) => read.path === 'manufacturing_steps' && read.finished)).toBeTruthy();
          } else {
            await expect(opened.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toBeEditable();
          }
          if (screen === 'AWI') await saved(opened);
          await expect.poll(() => opened.evaluate(() => (window as unknown as { pulseOpeningTimings: { editableAt: number } }).pulseOpeningTimings.editableAt)).toBeGreaterThan(0);
          const editableMilliseconds = await opened.evaluate(() => (window as unknown as { pulseOpeningTimings: { editableAt: number } }).pulseOpeningTimings.editableAt) - start;
          const browserTiming = await opened.evaluate(() => ({
            navigation: performance.getEntriesByType('navigation').map((entry) => {
              const nav = entry as PerformanceNavigationTiming;
              return { responseStart: nav.responseStart, responseEnd: nav.responseEnd, domInteractive: nav.domInteractive };
            }),
            scripts: performance.getEntriesByType('resource')
              .filter((entry) => entry.name.includes('/_next/') && entry.name.endsWith('.js'))
              .map((entry) => ({ file: new URL(entry.name).pathname.split('/').pop(), start: entry.startTime, end: (entry as PerformanceResourceTiming).responseEnd, bytes: (entry as PerformanceResourceTiming).encodedBodySize })),
          }));
          results.push({ screen, addedLatency, run, editableMilliseconds, browserTiming, reads });
          if (addedLatency) {
            const membership = reads.find((read) => read.path === 'workspace_members' && read.scope === 'workspace_id');
            expect(membership, 'Fresh core membership check').toBeDefined();
            const organization = reads.filter((read) => read.path === 'workspaces' && read.scope === 'id')
              .sort((left, right) => Math.abs(left.started - membership!.started) - Math.abs(right.started - membership!.started))[0];
            expect(organization?.finished).toBeDefined();
            // Check actual overlap instead of a flaky millisecond speed target.
            expect(membership!.started).toBeLessThan(organization.finished!);
            expect(reads.some((read) => read.path === 'rpc/is_super_admin' && read.started < organization.finished! &&
              (read.finished ?? 0) >= organization.started)).toBe(true);
          }
        } finally { await context.close(); }
      }
    }
  }
  console.log('Opening traces (80 ms is simulated latency per browser read):', JSON.stringify(results));
});

test('a fresh AWI opening respects a changed view-only permission', async ({ page, browser }) => {
  const url = await createDraft(page);
  await edit(page, 'Preserve this instruction when author access changes.');
  await page.goto(`/awi?workspace=${workspace}`);
  await expect(page.getByRole('heading', { name: 'AWI Master List', exact: true })).toBeVisible();
  await db.query("update product_module_access set level='view' where workspace_id=$1 and user_id=$2", [workspace, user]);
  const fresh = await browser.newContext();
  try {
    await authenticate(fresh);
    const opened = await fresh.newPage();
    opened.on('pageerror', (error) => pageErrors.push(error.message));
    await opened.goto(url);
    await saved(opened);
    await expect(opened.getByText('[View-only access]', { exact: true })).toBeVisible();
    const instruction = opened.getByRole('textbox', { name: 'Step 1 instruction', exact: true });
    await expect(instruction).toHaveValue('Preserve this instruction when author access changes.');
    await expect(opened.getByRole('button', { name: 'Edit AWI name', exact: true })).toHaveCount(0);
    const writes: string[] = [];
    opened.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      // Supabase invokes these read-only permission/scope RPCs with POST. Keep
      // actual mutation endpoints (including procedure-save RPCs) monitored.
      const readRpc = path === '/rest/v1/rpc/is_super_admin' || path === '/rest/v1/rpc/task_project_id';
      if (path.startsWith('/rest/v1/') && !readRpc &&
          ['POST', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
    });
    await expect(instruction).not.toBeEditable();
    await expect(opened.getByRole('button', { name: 'Add Step', exact: true })).toBeDisabled();
    // Observe beyond the edit debounce so a delayed write cannot pass unnoticed.
    await opened.waitForTimeout(1000);
    expect(writes).toEqual([]);
    expect((await db.query('select s.instruction from manufacturing_steps s join awi_masters m on m.task_id=s.task_id where m.workspace_id=$1', [workspace])).rows[0]?.instruction).toBe('Preserve this instruction when author access changes.');
  } finally { await fresh.close(); }
});

test('Product module shares another author AWI with View and Edit and enforces revocation', async ({ page, browser }) => {
  const url = await createDraft(page, 'AWI-SHARED');
  await edit(page, 'Instruction created by the first author.');
  const teammateEmail = `teammate-${randomUUID()}@awi-browser.test`;
  const made = await admin.auth.admin.createUser({ email: teammateEmail, password, email_confirm: true, user_metadata: { full_name: "Product Teammate" } });
  if (made.error) throw made.error;
  const teammate = made.data.user.id;
  await db.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'editor') on conflict(workspace_id,user_id) do update set role='editor'", [workspace, teammate]);
  await db.query("insert into product_module_access(workspace_id,user_id,level) values($1,$2,'view')", [workspace, teammate]);
  const shared = await browser.newContext();
  try {
    await authenticate(shared, teammateEmail);
    const other = await shared.newPage();
    other.on('pageerror', (error) => pageErrors.push(error.message));
    await other.goto(`/awi?workspace=${workspace}`);
    await expect(other.getByRole('link').filter({ hasText: 'AWI-SHARED' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Add AWI', exact: true })).toHaveCount(0);
    await other.getByRole('link').filter({ hasText: 'AWI-SHARED' }).click();
    await expect(other.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveValue('Instruction created by the first author.');
    await expect(other.getByText('[View-only access]', { exact: true })).toBeVisible();
    await expect(other.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).not.toBeEditable();
    await other.getByRole('button', { name: 'Revisions', exact: true }).click();
    await expect(other.getByRole('dialog')).toBeVisible();
    await other.getByRole('button', { name: 'Close document control', exact: true }).click();
    await other.screenshot({ path: test.info().outputPath('product-shared-view.png'), fullPage: true });
    expect((await db.query('select count(*)::int n from project_access where user_id=$1', [teammate])).rows[0].n).toBe(0);
    await db.query("update product_module_access set level='edit' where workspace_id=$1 and user_id=$2", [workspace, teammate]);
    await other.reload();
    await expect(other.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toBeEditable();
    await edit(other, 'Updated by the second Product editor.');
    await db.query("update product_module_access set level='view' where workspace_id=$1 and user_id=$2", [workspace, teammate]);
    await other.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(other.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).not.toBeEditable();
    await db.query("update product_module_access set level='none' where workspace_id=$1 and user_id=$2", [workspace, teammate]);
    await other.goto(`/awi?workspace=${workspace}`);
    await expect(other.getByRole('heading', { name: 'Product access required' })).toBeVisible();
    await other.goto(url);
    await expect(other.getByRole('textbox', { name: 'Step 1 instruction', exact: true })).toHaveCount(0);
  } finally { await shared.close(); }
});

test('Product opens an empty portfolio and a new AWI without per-project grants', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Product Line design/ })).toBeVisible();
  await page.getByRole('link', { name: /Product Line design/ }).click();
  await expect(page.getByRole('heading', { name: 'AWI Master List', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add AWI', exact: true })).toBeVisible();
  expect((await db.query('select count(*)::int n from project_access where user_id=$1', [user])).rows[0].n).toBe(0);
});
