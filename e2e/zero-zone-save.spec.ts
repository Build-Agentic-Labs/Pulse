// Zero-zone products: once the Unzoned station has been saved, later shell saves used to send it twice
// and fail (Postgres 21000) after a partial write. Disposable workspace, user and product; durable
// database rows are the evidence, not the displayed save status.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';

const api = 'http://127.0.0.1:56321';
const password = 'Browser-test-Password-42!';
const db = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:56322/postgres' });
const admin = createClient(api, process.env.E2E_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test.afterAll(async () => { await db.end(); });

test('a zero-zone product with a saved Unzoned station keeps saving product and Gantt edits across a reload', async ({ context, page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const failedWrites: string[] = [];
  page.on('response', (response) => {
    const method = response.request().method();
    if (response.status() >= 400 && method !== 'GET' && response.url().includes('/rest/v1/')) {
      failedWrites.push(`${method} ${response.url().split('?')[0]?.replace(api, '')} ${response.status()}`);
    }
  });

  const workspace = `ws-zero-zone-${randomUUID()}`;
  const email = `planner-${randomUUID()}@zero-zone-browser.test`;
  await db.query('insert into workspaces(id,name) values($1,$2)', [workspace, 'Zero-zone browser organization']);
  await db.query('insert into workspace_auto_join_domains(domain,workspace_id) values($1,$2) on conflict(domain) do update set workspace_id=excluded.workspace_id', ['zero-zone-browser.test', workspace]);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Zero Zone Planner' } });
  if (error) throw error;
  const user = data.user.id;
  await db.query('insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3) on conflict(workspace_id,user_id) do update set role=excluded.role', [workspace, user, 'editor']);
  await db.query("insert into product_module_access(workspace_id,user_id,level) values($1,$2,'edit')", [workspace, user]);
  const auth = createServerClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [],
      setAll: async (cookies) => {
        await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: '127.0.0.1', path: '/', sameSite: 'Lax' as const })));
      },
    },
  });
  const signIn = await auth.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const connection = await db.connect();
  let projectId: string;
  try {
    await connection.query('begin');
    await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await connection.query('set local role authenticated');
    projectId = (await connection.query('select public.create_project_with_starter_plan($1,$2) id', [workspace, 'Zero-zone product'])).rows[0].id;
    await connection.query('commit');
  } catch (caught) { await connection.query('rollback'); throw caught; } finally { connection.release(); }
  const scenario = (await db.query('select s.id from scenarios s join products p on p.id=s.product_id where p.project_id=$1', [projectId])).rows[0].id;
  expect((await db.query('select count(*)::int n from zones where scenario_id=$1', [scenario])).rows[0].n).toBe(0);

  // The state a first save of a zero-zone product leaves: an Unzoned station, tasks assigned to it.
  const unzoned = `station-${scenario}-unzoned`;
  await db.query(`insert into stations(id,scenario_id,sequence,name,owner_name,planned_cycle_minutes,planned_operators,planned_man_hours,takt_status,bottleneck_flag,area)
    values($1,$2,1,'Unzoned','',0,1,0,'missing',false,'Unzoned')`, [unzoned, scenario]);
  const taskIds = [`zero-zone-task-${randomUUID()}`, `zero-zone-task-${randomUUID()}`];
  for (const [index, id] of taskIds.entries()) {
    await db.query(`insert into tasks(id,scenario_id,station_id,name,wbs,planned_start,planned_finish,planned_duration_minutes,planned_operators)
      values($1,$2,$3,$4,$5,now(),now(),60,1)`, [id, scenario, unzoned, `Original task ${index + 1}`, String(index + 1)]);
  }

  const taskMinutes = async (id: string) => (await db.query('select planned_duration_minutes::float8 m from tasks where id=$1', [id])).rows[0]?.m;
  const productName = async () => (await db.query('select name from products where project_id=$1', [projectId])).rows[0]?.name;
  const stationRows = async () => (await db.query('select id from stations where scenario_id=$1', [scenario])).rows.map((row) => row.id);
  const taskStations = async () => (await db.query('select station_id from tasks where scenario_id=$1 order by wbs', [scenario])).rows.map((row) => row.station_id);
  const ganttDuration = (target: Page, wbs: string) => target.getByRole('textbox', { name: `${wbs} duration hours`, exact: true });
  // Waits for a durable value; a timeout names any write the server rejected meanwhile.
  async function persisted<T>(read: () => Promise<T>, expected: T) {
    try {
      await expect.poll(read).toBe(expected);
    } catch (caught) {
      throw new Error(`${(caught as Error).message}\nRejected writes: ${failedWrites.join('; ') || 'none'}`);
    }
  }
  async function openGantt() {
    await page.goto(`/projects/${projectId}/planner?view=gantt`);
    await expect(ganttDuration(page, '2')).toBeVisible();
    // The editable core is behind an inert gate until the remote load confirms it.
    await expect.poll(() => ganttDuration(page, '1').evaluate((element) => element.closest('[inert]') === null)).toBe(true);
  }

  // 1. Save the zero-zone product: a Gantt edit through the shell autosave.
  await openGantt();
  await ganttDuration(page, '1').fill('2');
  await ganttDuration(page, '1').press('Tab');
  await persisted(() => taskMinutes(taskIds[0]!), 120);

  // 2. Reload, make further edits (Gantt and product), and save again.
  await openGantt();
  await expect(ganttDuration(page, '1')).toHaveValue('2');
  await ganttDuration(page, '2').fill('3');
  await ganttDuration(page, '2').press('Tab');
  await persisted(() => taskMinutes(taskIds[1]!), 180);
  await page.goto(`/projects/${projectId}/planner?view=setup`);
  await page.getByRole('button', { name: 'Product', exact: true }).first().click();
  const product = page.getByLabel('Product', { exact: true });
  await expect.poll(() => product.evaluate((element) => element.closest('[inert]') === null)).toBe(true);
  await product.fill('Zero-zone product renamed after reload');
  await persisted(productName, 'Zero-zone product renamed after reload');

  // 3. Durable result: both edits stored, still exactly one Unzoned station, assignments unchanged.
  expect(await taskMinutes(taskIds[0]!)).toBe(120);
  expect(await stationRows()).toEqual([unzoned]);
  expect(await taskStations()).toEqual([unzoned, unzoned]);
  expect(failedWrites).toEqual([]);
  await expect(page.getByText('Save failed')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
