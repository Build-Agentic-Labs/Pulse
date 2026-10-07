// LOCAL ONLY. Persists named synthetic fixtures in the new WI test database; deletes no data.
import pg from "pg";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const root = new pg.Client({
  host: "127.0.0.1",
  port: 57722,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
await root.connect();
const clients = [];
try {
  const identity = await root.query(
    "select to_regclass('public.quality_work_instructions') is not null wi, inet_server_port() port",
  );
  assert(identity.rows[0].wi);
  assert.equal(identity.rows[0].port, 5432);
  const sql = readFileSync(
    "tests/quality-work-instructions/database.sql",
    "utf8",
  );
  const fixture = sql
    .slice(
      sql.indexOf("insert into public.workspaces"),
      sql.indexOf("create function public.wi_test_actor"),
    )
    .replaceAll("wi-test", "wi-concurrent")
    .replaceAll("wi-other", "wi-concurrent-other")
    .replaceAll("e7100000", "e8100000");
  await root.query("begin");
  await root.query(fixture);
  await root.query("commit");
  const actor = "e8100000-0000-0000-0000-000000000001",
    department = "wi-concurrent-pro",
    workspace = "wi-concurrent-ws";
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) {
    await root.query(
      "insert into public.quality_work_instructions(id,workspace_id,department_id,title,purpose,responsibilities,created_by) values($1,$2,$3,$4,$5,$6,$7)",
      [id, workspace, department, "Procedure", "Scope", "Author", actor],
    );
    await root.query(
      "insert into public.quality_wi_steps(id,wi_id,position,title,instruction) values($1,$2,1,$3,$4)",
      [randomUUID(), id, "Act", "Act now"],
    );
  }
  const publish = async (id, operation) => {
    const db = new pg.Client({
      host: "127.0.0.1",
      port: 57722,
      user: "postgres",
      password: "postgres",
      database: "postgres",
    });
    clients.push(db);
    await db.connect();
    await db.query("begin");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: actor, role: "authenticated" }),
    ]);
    await db.query("set local role authenticated");
    try {
      const result = await db.query(
        "select public.publish_quality_wi($1,1,$2,$3,$4) result",
        [id, operation, "Initial", actor],
      );
      await db.query("commit");
      return result.rows[0].result;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  };
  const operations = [randomUUID(), randomUUID()];
  const results = await Promise.all(
    ids.slice(0, 2).map((id, i) => publish(id, operations[i])),
  );
  assert.equal(new Set(results.map((r) => r.documentNumber)).size, 2);
  assert.deepEqual(results.map((r) => r.documentNumber).sort(), [
    "WI-WIP-001",
    "WI-WIP-002",
  ]);
  const replay = await publish(ids[0], operations[0]);
  assert.deepEqual(replay, results[0]);
  const trigger = await root.query(
    `create function public.wi_test_fail_commit() returns trigger language plpgsql as $$ begin if new.id='${ids[2]}'::uuid and not new.has_changes then raise exception 'Injected failure'; end if; return new; end $$; create trigger wi_test_fail_commit before update on public.quality_work_instructions for each row execute function public.wi_test_fail_commit();`,
  );
  assert(trigger);
  await assert.rejects(publish(ids[2], randomUUID()), /Injected failure/);
  const after = await root.query(
    "select (select next_seq from public.doc_number_counter where department_id=$1 and doc_type='WI') counter,(select document_number from public.quality_work_instructions where id=$2) number,(select count(*)::int from public.quality_wi_revisions where wi_id=$2) revisions",
    [department, ids[2]],
  );
  assert.deepEqual(after.rows[0], { counter: 3, number: null, revisions: 0 });
  await root.query(
    "drop trigger wi_test_fail_commit on public.quality_work_instructions;drop function public.wi_test_fail_commit()",
  );
  const evidence = {
    simultaneousPublishers: 2,
    uniqueNumbers: results.map((r) => r.documentNumber),
    exactReplay: true,
    commitFailurePreservedCounterAndDraft: true,
    syntheticFixturesRetained: true,
  };
  writeFileSync(
    "scratch/quality-wi-build/concurrency.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} finally {
  for (const db of clients) await db.end();
  await root.end();
}
