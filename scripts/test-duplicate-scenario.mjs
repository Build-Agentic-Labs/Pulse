// Integration test for the duplicate_scenario RPC.
//
// Runs ENTIRELY inside one transaction that is ALWAYS rolled back, so it proves the function against
// the real schema + real data (the largest scenario in the DB) while persisting absolutely nothing —
// not even the function definition. Asserts: per-table row-count parity, FK isolation (every copied
// row references only copied rows / the new scenario), actual/progress fields reset, and that
// actual_events are not copied.
//
//   node --env-file=.env.local scripts/test-duplicate-scenario.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATION = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260604120000_duplicate_scenario_rpc.sql",
);

const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${detail ? "  -> " + detail : ""}`);
    failures.push(name);
  }
}

async function count(client, sql, params) {
  const r = await client.query(sql, params);
  return Number(r.rows[0].c);
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");

    // Create the function inside the transaction (rolled back at the end -> never persisted).
    await client.query(await readFile(MIGRATION, "utf8"));

    // Source = the scenario with the most tasks (the real FlexBoost lane).
    const src = (
      await client.query(
        "select scenario_id, count(*)::int c from public.tasks group by scenario_id order by c desc limit 1",
      )
    ).rows[0].scenario_id;
    console.log(`Source scenario: ${src}`);

    const srcTasksFilter = "task_id in (select id from public.tasks where scenario_id = $1)";
    const before = {
      stations: await count(client, "select count(*) c from public.stations where scenario_id=$1", [src]),
      zones: await count(client, "select count(*) c from public.zones where scenario_id=$1", [src]),
      components: await count(client, "select count(*) c from public.manufacturing_components where scenario_id=$1", [src]),
      tasks: await count(client, "select count(*) c from public.tasks where scenario_id=$1", [src]),
      steps: await count(client, `select count(*) c from public.manufacturing_steps where ${srcTasksFilter}`, [src]),
      tools: await count(client, `select count(*) c from public.step_tools where ${srcTasksFilter}`, [src]),
      photos: await count(client, `select count(*) c from public.step_photos where ${srcTasksFilter} and deleted_at is null`, [src]),
      deps: await count(
        client,
        "select count(*) c from public.task_dependencies where predecessor_task_id in (select id from public.tasks where scenario_id=$1) and successor_task_id in (select id from public.tasks where scenario_id=$1)",
        [src],
      ),
      parts: await count(client, `select count(*) c from public.part_references where ${srcTasksFilter}`, [src]),
      customCols: await count(client, "select count(*) c from public.custom_columns where scenario_id=$1", [src]),
    };
    console.log("Source counts:", JSON.stringify(before));

    // --- Run the duplicate ---
    const newId = (await client.query("select public.duplicate_scenario($1, $2) as id", [src, "TEST copy (rollback)"]))
      .rows[0].id;
    console.log(`New scenario: ${newId}`);
    const suffix = newId.replace(/^scenario-/, "");
    const endsWithSuffix = "$2"; // bound to '%-' || suffix

    const newTasks = "id in (select id from public.tasks where scenario_id = $1)";
    const after = {
      stations: await count(client, "select count(*) c from public.stations where scenario_id=$1", [newId]),
      zones: await count(client, "select count(*) c from public.zones where scenario_id=$1", [newId]),
      components: await count(client, "select count(*) c from public.manufacturing_components where scenario_id=$1", [newId]),
      tasks: await count(client, "select count(*) c from public.tasks where scenario_id=$1", [newId]),
      steps: await count(client, `select count(*) c from public.manufacturing_steps where task_id in (select id from public.tasks where scenario_id=$1)`, [newId]),
      tools: await count(client, `select count(*) c from public.step_tools where task_id in (select id from public.tasks where scenario_id=$1)`, [newId]),
      photos: await count(client, `select count(*) c from public.step_photos where task_id in (select id from public.tasks where scenario_id=$1)`, [newId]),
      deps: await count(
        client,
        "select count(*) c from public.task_dependencies where predecessor_task_id in (select id from public.tasks where scenario_id=$1) and successor_task_id in (select id from public.tasks where scenario_id=$1)",
        [newId],
      ),
      parts: await count(client, `select count(*) c from public.part_references where task_id in (select id from public.tasks where scenario_id=$1)`, [newId]),
      customCols: await count(client, "select count(*) c from public.custom_columns where scenario_id=$1", [newId]),
    };
    console.log("Copied counts:", JSON.stringify(after));

    // A duplicate is a high-level Gantt projection: copy the skeleton, drop procedure/documentation.
    const COPIED = ["stations", "zones", "components", "tasks", "deps", "customCols"];
    const NOT_COPIED = ["steps", "tools", "photos", "parts"];

    console.log("\n[row-count parity — Gantt skeleton copied]");
    for (const k of COPIED) {
      check(`${k}: ${after[k]} == source ${before[k]}`, after[k] === before[k], `got ${after[k]}`);
    }

    console.log("\n[high-level projection — procedures/tools/photos/parts NOT copied]");
    for (const k of NOT_COPIED) {
      check(`${k} NOT copied (source has ${before[k]})`, after[k] === 0, `got ${after[k]}`);
    }

    console.log("\n[traceability + new scenario]");
    const sc = (await client.query("select name, notes from public.scenarios where id=$1", [newId])).rows[0];
    check("new scenario exists", Boolean(sc));
    check('notes start with "Copied from"', Boolean(sc) && /^Copied from /.test(sc.notes || ""), sc?.notes);

    console.log("\n[FK isolation — copied rows reference only copied rows]");
    check(
      "no copied task references a non-copied station",
      0 === (await count(client, `select count(*) c from public.tasks where scenario_id=$1 and station_id is not null and station_id not in (select id from public.stations where scenario_id=$1)`, [newId])),
    );
    check(
      "no copied task references a non-copied zone",
      0 === (await count(client, `select count(*) c from public.tasks where scenario_id=$1 and zone_id is not null and zone_id not in (select id from public.zones where scenario_id=$1)`, [newId])),
    );
    check(
      "no copied task references a non-copied component",
      0 === (await count(client, `select count(*) c from public.tasks where scenario_id=$1 and component_id is not null and component_id not in (select id from public.manufacturing_components where scenario_id=$1)`, [newId])),
    );
    check(
      "no copied task references a non-copied parent task",
      0 === (await count(client, `select count(*) c from public.tasks where scenario_id=$1 and parent_task_id is not null and parent_task_id not in (select id from public.tasks where scenario_id=$1)`, [newId])),
    );
    // Child tables: identify copied rows by suffix, then confirm they link to the new scenario's tasks.
    check(
      "every copied dependency links copied tasks",
      0 === (await count(client, `select count(*) c from public.task_dependencies where id like ${endsWithSuffix} and (predecessor_task_id not in (select id from public.tasks where scenario_id=$1) or successor_task_id not in (select id from public.tasks where scenario_id=$1))`, [newId, "%-" + suffix])),
    );

    console.log("\n[actuals / progress reset on the copy]");
    check(
      "copied tasks have no actuals and zero progress",
      0 === (await count(client, `select count(*) c from public.tasks where scenario_id=$1 and (actual_start is not null or actual_finish is not null or actual_duration_minutes is not null or actual_operators is not null or actual_man_hours is not null or percent_complete <> 0 or status <> 'not_started')`, [newId])),
    );
    check(
      "copied stations have no actuals",
      0 === (await count(client, `select count(*) c from public.stations where scenario_id=$1 and (actual_cycle_minutes is not null or actual_operators is not null or actual_man_hours is not null)`, [newId])),
    );
    check(
      "no actual_events copied to the new scenario",
      0 === (await count(client, `select count(*) c from public.actual_events where task_id in (select id from public.tasks where scenario_id=$1)`, [newId])),
    );

    // Spot-check the planned baseline IS preserved (a copy must look the same, just without progress).
    const plannedMatch = (
      await client.query(
        `select
           (select coalesce(sum(planned_duration_minutes),0) from public.tasks where scenario_id=$1) as src_planned,
           (select coalesce(sum(planned_duration_minutes),0) from public.tasks where scenario_id=$2) as new_planned`,
        [src, newId],
      )
    ).rows[0];
    check(
      "planned baseline preserved (sum planned_duration_minutes matches)",
      String(plannedMatch.src_planned) === String(plannedMatch.new_planned),
      `src ${plannedMatch.src_planned} vs new ${plannedMatch.new_planned}`,
    );

    await client.query("rollback");
    console.log("\nRolled back — nothing persisted.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error("\nTEST ERROR:", error.message);
    failures.push("threw: " + error.message);
  } finally {
    await client.end();
  }

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED ✅" : `FAILED (${failures.length}): ` + failures.join("; ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
