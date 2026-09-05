// Exercises real RLS as synthetic users. All fixtures and optional migration DDL
// run in ONE transaction that is always rolled back; never sends invitations.
// node --env-file=.env.local scripts/test-rbac-boundaries.mjs [--with-fix]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = (n) => `f4000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
async function asUser(n) {
  await db.query('reset role');
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid(n), role: 'authenticated', email: `user${n}@rbac-boundary.test` })]);
  await db.query('set local role authenticated');
}
async function scalar(sql) { return (await db.query(sql)).rows[0].value; }
async function denied(sql, pattern) {
  await assert.rejects(db.query(sql), (error) => pattern.test(error.message));
}
const tests = [
  ['legacy owner_id cannot elevate an admin', async () => {
    await asUser(2);
    await db.query(`update workspaces set owner_id='${uid(2)}' where id='rbac_test_a'`);
    assert.equal(await scalar("select has_workspace_role('rbac_test_a', array['owner']::workspace_role[]) as value"), false);
  }],
  ['demoted original owner loses owner authority', async () => {
    await db.query(`update workspace_members set role='viewer' where workspace_id='rbac_test_a' and user_id='${uid(1)}'`);
    await asUser(1);
    assert.equal(await scalar("select has_workspace_role('rbac_test_a', array['owner']::workspace_role[]) as value"), false);
  }],
  ['orphan project grant denies reads and writes', async () => {
    await asUser(6);
    assert.equal(await scalar("select has_project_access('rbac_test_project', 'view') as value"), false);
    assert.equal(await scalar("select has_project_access('rbac_test_project', 'edit') as value"), false);
    assert.equal(await scalar("select count(*)::int as value from projects where id='rbac_test_project'"), 0);
  }],
  ['editor with view grant cannot rename a project', async () => {
    await asUser(4);
    const result = await db.query("update projects set name='Unauthorized' where id='rbac_test_project' returning id");
    assert.equal(result.rowCount, 0);
  }],
  ['viewer with edit grant can rename their project', async () => {
    await asUser(5);
    const result = await db.query("update projects set name='Authorized' where id='rbac_test_project' returning id");
    assert.equal(result.rowCount, 1);
  }],
  ['admin cannot remove a peer admin', async () => {
    await asUser(2);
    await denied(`select remove_workspace_member('rbac_test_a','${uid(3)}')`, /Only an owner/);
  }],
  ['owner can remove an admin', async () => {
    await asUser(1);
    await db.query(`select remove_workspace_member('rbac_test_a','${uid(3)}')`);
    assert.equal(await scalar(`select count(*)::int as value from workspace_members where workspace_id='rbac_test_a' and user_id='${uid(3)}'`), 0);
  }],
  ['admin can remove an ordinary member', async () => {
    await asUser(2);
    await db.query(`select remove_workspace_member('rbac_test_a','${uid(4)}')`);
    assert.equal(await scalar(`select count(*)::int as value from workspace_members where workspace_id='rbac_test_a' and user_id='${uid(4)}'`), 0);
  }],
  ['direct membership deletion cannot bypass offboarding cleanup', async () => {
    await asUser(1);
    const result = await db.query(`delete from workspace_members where workspace_id='rbac_test_a' and user_id='${uid(4)}' returning user_id`);
    assert.equal(result.rowCount, 0);
  }],
  ['former member cannot read SOP via historical review seat', async () => {
    await asUser(6);
    assert.equal(await scalar("select holds_sop_seat('rbac_test_sop') as value"), false);
    assert.equal(await scalar("select count(*)::int as value from sops where id='rbac_test_sop'"), 0);
  }],
  ['former member loses department and Quality authority', async () => {
    await asUser(6);
    assert.equal(await scalar("select is_department_member('rbac_test_dept') as value"), false);
    assert.equal(await scalar("select is_quality_approver('rbac_test_a') as value"), false);
    assert.equal(await scalar("select has_department_role('rbac_test_dept', array['approver']::department_sop_role[]) as value"), false);
  }],
  ['active member keeps department authority and seat access', async () => {
    await asUser(5);
    assert.equal(await scalar("select is_department_member('rbac_test_dept') as value"), true);
    assert.equal(await scalar("select has_department_role('rbac_test_dept', array['author']::department_sop_role[]) as value"), true);
  }],
  ['admin cannot invite a manager as a member to demote them', async () => {
    await asUser(2);
    await denied(`insert into workspace_access_grants(workspace_id,email,role) values ('rbac_test_a','user3@rbac-boundary.test','editor')`, /Only an owner/);
  }],
  ['redeeming an old invitation cannot demote a promoted admin', async () => {
    await db.query(`insert into workspace_access_grants(workspace_id,email,role,granted_by) values ('rbac_test_a','user3@rbac-boundary.test','editor','${uid(1)}')`);
    await asUser(3);
    await db.query('select redeem_workspace_access_grants()');
    assert.equal(await scalar(`select role::text as value from workspace_members where workspace_id='rbac_test_a' and user_id='${uid(3)}'`), 'admin');
  }],
  ['ordinary invite applies grants once and does not restore later revoked access', async () => {
    await db.query(`insert into workspace_access_grants(workspace_id,email,role,quality_access,planning_access,project_access,granted_by)
      values ('rbac_test_a','user4@rbac-boundary.test','editor','edit',true,'[{"project_id":"rbac_test_project","level":"edit"}]','${uid(1)}')`);
    await asUser(4);
    await db.query('select redeem_workspace_access_grants()');
    assert.equal(await scalar("select has_project_access('rbac_test_project','edit') as value"), true);
    assert.equal(await scalar("select has_org_tool_access('rbac_test_a','edit') as value"), true);
    assert.equal(await scalar("select has_space_access('rbac_test_a','planning') as value"), true);
    await asUser(1);
    await db.query(`update project_access set level='view' where project_id='rbac_test_project' and user_id='${uid(4)}'`);
    await asUser(4);
    await db.query('select redeem_workspace_access_grants()');
    assert.equal(await scalar("select has_project_access('rbac_test_project','edit') as value"), false);
  }],
  ['ordinary member cannot grant themselves project access', async () => {
    await asUser(4);
    const result = await db.query(`update project_access set level='edit' where project_id='rbac_test_project' and user_id='${uid(4)}' returning project_id`);
    assert.equal(result.rowCount, 0);
  }],
  ['membership cannot be moved to another organization', async () => {
    await asUser(1);
    await denied(`update workspace_members set workspace_id='rbac_test_b' where workspace_id='rbac_test_a' and user_id='${uid(4)}'`, /Membership identity cannot be changed/);
  }],
  ['project cannot be moved to another organization', async () => {
    await asUser(1);
    await denied("update projects set workspace_id='rbac_test_b' where id='rbac_test_project'", /Project identity and organization cannot be changed/);
  }],
  ['last owner cannot be demoted', async () => {
    await asUser(1);
    await denied(`update workspace_members set role='viewer' where workspace_id='rbac_test_b' and user_id='${uid(1)}'`, /at least one owner/);
  }],
  ['Quality grants cannot cross organizations', async () => {
    await asUser(5);
    assert.equal(await scalar("select has_org_tool_access('rbac_test_a','edit') as value"), true);
    assert.equal(await scalar("select has_org_tool_access('rbac_test_b','view') as value"), false);
  }],
  ['Planning grant requires membership', async () => {
    await asUser(6);
    assert.equal(await scalar("select has_space_access('rbac_test_a','planning') as value"), false);
  }],
];
await db.connect();
let failures = 0;
try {
  await db.query('begin');
  await db.query("set local lock_timeout='3s'; set local statement_timeout='15s'");
  if (process.argv.includes('--with-fix')) {
    await db.query(await readFile(new URL('../supabase/migrations/20260904120000_rbac_membership_boundaries.sql', import.meta.url), 'utf8'));
  }
  await db.query(`insert into workspaces(id,name) values ('rbac_test_a','RBAC Test A'),('rbac_test_b','RBAC Test B');
    insert into workspace_auto_join_domains(domain,workspace_id) values ('rbac-boundary.test','rbac_test_a');`);
  for (let n = 1; n <= 7; n++) {
    await db.query(`insert into auth.users(id,aud,role,email,email_confirmed_at) values ($1,'authenticated','authenticated',$2,now())`, [uid(n), `user${n}@rbac-boundary.test`]);
  }
  await db.query(`
    insert into workspace_members(workspace_id,user_id,role) values
      ('rbac_test_a','${uid(1)}','owner'),('rbac_test_a','${uid(2)}','admin'),
      ('rbac_test_a','${uid(3)}','admin'),('rbac_test_a','${uid(4)}','editor'),
      ('rbac_test_a','${uid(5)}','viewer'),('rbac_test_a','${uid(6)}','editor'),
      ('rbac_test_a','${uid(7)}','owner'),('rbac_test_b','${uid(1)}','owner');
    update workspaces set owner_id='${uid(1)}' where id='rbac_test_a';
    insert into projects(id,workspace_id,name) values ('rbac_test_project','rbac_test_a','RBAC Project');
    insert into project_access(project_id,user_id,level) values
      ('rbac_test_project','${uid(4)}','view'),('rbac_test_project','${uid(5)}','edit'),('rbac_test_project','${uid(6)}','edit');
    insert into org_tool_access(workspace_id,user_id,level) values ('rbac_test_a','${uid(5)}','edit'),('rbac_test_a','${uid(6)}','edit');
    insert into space_access(workspace_id,user_id,space) values ('rbac_test_a','${uid(6)}','planning');
    insert into departments(id,workspace_id,code,name,is_quality_gate) values ('rbac_test_dept','rbac_test_a','TST','RBAC Quality',true);
    insert into department_members(department_id,user_id,dept_role) values
      ('rbac_test_dept','${uid(5)}','author'),('rbac_test_dept','${uid(6)}','approver');
    insert into sops(id,workspace_id,sop_number,title,document,status,created_by,department_id)
      values ('rbac_test_sop','rbac_test_a','TST-SOP-001','RBAC draft','{}','draft','${uid(5)}','rbac_test_dept');
    insert into sop_review_seats(sop_id,department_id,rasic,signer_id)
      values ('rbac_test_sop','rbac_test_dept','responsible','${uid(6)}');
    delete from workspace_members where workspace_id='rbac_test_a' and user_id='${uid(6)}';
  `);
  for (const [name, run] of tests) {
    await db.query('savepoint test_case');
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`); }
    finally { await db.query('rollback to savepoint test_case'); }
  }
} finally {
  await db.query('rollback');
  await db.end();
}
console.log(`${tests.length-failures}/${tests.length} passed. All fixtures and migration DDL rolled back.`);
process.exitCode = failures ? 1 : 0;
