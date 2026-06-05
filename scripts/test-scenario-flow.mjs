// Live two-scenario flow test (persists, verifies, then cleans up).
//
// Proves the end-to-end flow on the REAL database: duplicate Main -> a second scenario exists with the
// same high-level layout but zero progress -> Main is unchanged -> the copy's target can be set (which
// drives its takt via the Phase-2-tested calculateActiveTaktMinutes). Always deletes the copy at the
// end (cascade), so the DB is left exactly as it started.
//
//   node --env-file=.env.local scripts/test-scenario-flow.mjs

import pg from "pg";

const failures = [];
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures.push(name);
}
async function val(client, sql, params) {
  return (await client.query(sql, params)).rows[0];
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let newId = null;
  try {
    // Main = the product's earliest scenario (the one with the most tasks here = FlexBoost lane).
    const main = (
      await client.query("select scenario_id from public.tasks group by scenario_id order by count(*) desc limit 1")
    ).rows[0].scenario_id;
    const productId = (await val(client, "select product_id from public.scenarios where id=$1", [main])).product_id;

    const before = await val(
      client,
      `select
         (select count(*) from public.scenarios where product_id=$2)::int as scenarios,
         (select count(*) from public.tasks where scenario_id=$1)::int as main_tasks,
         (select coalesce(sum(planned_duration_minutes),0) from public.tasks where scenario_id=$1) as main_planned,
         (select coalesce(sum(percent_complete),0) from public.tasks where scenario_id=$1) as main_progress`,
      [main, productId],
    );
    console.log(`Main: ${main}  (${before.main_tasks} tasks, ${before.scenarios} scenario(s) on product)\n`);

    // --- DUPLICATE (persisted) ---
    newId = (await val(client, "select public.duplicate_scenario($1,$2) as id", [main, "FLOW TEST copy"])).id;
    console.log(`Duplicated -> ${newId}\n`);

    const after = await val(
      client,
      `select
         (select count(*) from public.scenarios where product_id=$3)::int as scenarios,
         (select count(*) from public.tasks where scenario_id=$2)::int as copy_tasks,
         (select coalesce(sum(planned_duration_minutes),0) from public.tasks where scenario_id=$2) as copy_planned,
         (select count(*) from public.tasks where scenario_id=$2 and (actual_start is not null or actual_finish is not null or actual_duration_minutes is not null or actual_operators is not null or actual_man_hours is not null or percent_complete<>0 or status<>'not_started'))::int as copy_with_progress,
         (select count(*) from public.manufacturing_steps where task_id in (select id from public.tasks where scenario_id=$2))::int as copy_steps,
         (select count(*) from public.tasks where scenario_id=$1)::int as main_tasks_now,
         (select coalesce(sum(planned_duration_minutes),0) from public.tasks where scenario_id=$1) as main_planned_now`,
      [main, newId, productId],
    );

    console.log("[a second scenario now exists]");
    check(`scenario count ${before.scenarios} -> ${after.scenarios} (+1)`, after.scenarios === before.scenarios + 1);

    console.log("\n[copy has the same high-level layout, zero progress, no procedures]");
    check(`copy task count ${after.copy_tasks} == Main ${before.main_tasks}`, after.copy_tasks === before.main_tasks);
    check("copy planned baseline matches Main", String(after.copy_planned) === String(before.main_planned), `${after.copy_planned} vs ${before.main_planned}`);
    check("copy has ZERO progress/actuals", after.copy_with_progress === 0, `${after.copy_with_progress} tasks with progress`);
    check("copy has NO procedure steps", after.copy_steps === 0, `${after.copy_steps} steps`);

    console.log("\n[Main is unchanged]");
    check(`Main task count still ${before.main_tasks}`, after.main_tasks_now === before.main_tasks);
    check("Main planned baseline unchanged", String(after.main_planned_now) === String(before.main_planned));

    console.log("\n[set the copy's projection target -> drives its takt]");
    await client.query("update public.scenarios set target_output=$2, target_output_period=$3 where id=$1", [newId, 500, "year"]);
    const tgt = await val(client, "select target_output, target_output_period from public.scenarios where id=$1", [newId]);
    check("copy target persisted as 500 / year", Number(tgt.target_output) === 500 && tgt.target_output_period === "year", JSON.stringify(tgt));
    console.log("    (takt re-flagging follows from calculateActiveTaktMinutes — covered by active-takt.test.ts)");

    // --- CLEANUP (always) ---
    const del = await client.query("delete from public.scenarios where id=$1", [newId]);
    newId = null;
    const finalScenarios = (await val(client, "select count(*)::int c from public.scenarios where product_id=$1", [productId])).c;
    console.log(`\nDeleted copy (${del.rowCount} scenario row, cascade).`);
    check(`scenario count back to ${before.scenarios}`, finalScenarios === before.scenarios, `now ${finalScenarios}`);
  } catch (error) {
    console.error("\nFLOW ERROR:", error.message);
    failures.push("threw: " + error.message);
  } finally {
    if (newId) {
      await client.query("delete from public.scenarios where id=$1", [newId]).catch(() => undefined);
      console.log("(cleanup) removed leftover copy");
    }
    await client.end();
  }

  console.log(`\n${failures.length === 0 ? "FLOW TEST PASSED ✅" : `FAILED (${failures.length}): ` + failures.join("; ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
