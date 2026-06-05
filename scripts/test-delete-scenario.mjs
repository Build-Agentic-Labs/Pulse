// Integration test for the delete_scenario RPC guard. Runs entirely in one transaction that is ALWAYS
// rolled back (persists nothing). Uses the already-applied duplicate_scenario to make a projection to
// delete, and savepoints so the expected RAISEs don't abort the surrounding transaction.
//
//   node --env-file=.env.local scripts/test-delete-scenario.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATION = path.join(process.cwd(), "supabase", "migrations", "20260605120000_delete_scenario_rpc.sql");

const failures = [];
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures.push(name);
}
async function count(client, sql, params) {
  return Number((await client.query(sql, params)).rows[0].c);
}
// Run a statement expected to RAISE; recover via savepoint so the transaction stays usable.
async function expectRaise(client, sql, params, needle) {
  await client.query("savepoint sp");
  let message = null;
  try {
    await client.query(sql, params);
  } catch (error) {
    message = error.message;
  }
  await client.query("rollback to savepoint sp");
  return { raised: message !== null, message: message ?? "" , matched: Boolean(message && message.toLowerCase().includes(needle.toLowerCase())) };
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(await readFile(MIGRATION, "utf8")); // create delete_scenario (rolled back later)

    // Pick the product with the most tasks, then Main = its EARLIEST scenario (the RPC's definition).
    const productId = (
      await client.query(
        "select s.product_id from public.tasks t join public.scenarios s on s.id=t.scenario_id group by s.product_id order by count(*) desc limit 1",
      )
    ).rows[0].product_id;
    const mainId = (
      await client.query("select id from public.scenarios where product_id=$1 order by created_at asc limit 1", [productId])
    ).rows[0].id;
    const beforeCount = await count(client, "select count(*) c from public.scenarios where product_id=$1", [productId]);
    console.log(`Main (earliest): ${mainId}  (${beforeCount} scenario(s) on product)\n`);

    // Make a projection to delete.
    const copyId = (await client.query("select public.duplicate_scenario($1,$2) as id", [mainId, "DEL TEST"])).rows[0].id;
    const dupCount = await count(client, "select count(*) c from public.scenarios where product_id=$1", [productId]);
    const copyTasks = await count(client, "select count(*) c from public.tasks where scenario_id=$1", [copyId]);
    check(`duplicate added a scenario (${beforeCount} -> ${dupCount})`, dupCount === beforeCount + 1);
    check(`copy has tasks (${copyTasks})`, copyTasks > 0);

    console.log("\n[guard: cannot delete Main while other scenarios exist]");
    const g1 = await expectRaise(client, "select public.delete_scenario($1)", [mainId], "main");
    check("deleting Main raises and refuses", g1.raised && g1.matched, g1.message || "(no raise)");
    check("Main still present after refusal", (await count(client, "select count(*) c from public.scenarios where id=$1", [mainId])) === 1);

    console.log("\n[success: delete a projection cascades its data]");
    await client.query("select public.delete_scenario($1)", [copyId]);
    const afterDel = await count(client, "select count(*) c from public.scenarios where product_id=$1", [productId]);
    check(`scenario count back to ${beforeCount}`, afterDel === beforeCount, `now ${afterDel}`);
    check("copy scenario row gone", (await count(client, "select count(*) c from public.scenarios where id=$1", [copyId])) === 0);
    check("copy tasks cascade-deleted", (await count(client, "select count(*) c from public.tasks where scenario_id=$1", [copyId])) === 0);
    check("copy stations cascade-deleted", (await count(client, "select count(*) c from public.stations where scenario_id=$1", [copyId])) === 0);

    console.log("\n[guard: cannot delete the only remaining scenario]");
    // Reduce to a single scenario (Main) inside a savepoint, then attempt to delete it.
    await client.query("savepoint only_setup");
    await client.query("delete from public.scenarios where product_id=$1 and id<>$2", [productId, mainId]);
    const onlyCount = await count(client, "select count(*) c from public.scenarios where product_id=$1", [productId]);
    const g2 = await expectRaise(client, "select public.delete_scenario($1)", [mainId], "only");
    await client.query("rollback to savepoint only_setup");
    check(`reduced to a single scenario for the check (${onlyCount})`, onlyCount === 1);
    check("deleting the only scenario raises and refuses", g2.raised && g2.matched, g2.message || "(no raise)");

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
