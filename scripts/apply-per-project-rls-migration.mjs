// Applies the per-project RLS isolation migration (20260601124000) inside a single
// transaction, with the same safety rails as apply-user-access-migrations.mjs:
//  - refuses any destructive SQL,
//  - asserts no data-table row counts change,
//  - rolls back on any error,
//  - then verifies the new helper function and rewritten policies are in place.
//
// This migration only rewrites RLS policy bodies and adds helper functions; it touches no
// data. Requires DATABASE_URL (Supabase Dashboard -> Project Settings -> Database ->
// Connection string -> URI), loaded from a gitignored env file, e.g.:
//   node --env-file=C:\Projects\Pulse\.env.local scripts/apply-per-project-rls-migration.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATION_FILES = ["20260601124000_per_project_rls_isolation.sql"];

// Data tables whose row counts must be unchanged by this (policy-only) migration.
const countTables = [
  "workspaces",
  "workspace_members",
  "workspace_access_grants",
  "projects",
  "products",
  "scenarios",
  "stations",
  "zones",
  "tasks",
  "task_dependencies",
  "manufacturing_steps",
  "part_references",
  "actual_events",
  "custom_columns",
  "project_access",
  "org_tool_access",
];

function assertMigrationIsNonDestructive(sql, label) {
  const forbidden = [
    /\bdrop\s+table\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
    /\bdrop\s+schema\b/i,
    /\balter\s+table\b.+\bdrop\s+column\b/is,
  ];

  for (const pattern of forbidden) {
    if (pattern.test(sql)) {
      throw new Error(`Refusing to run ${label}: matched unsafe pattern ${pattern}`);
    }
  }
}

async function countRows(client) {
  const counts = {};
  for (const table of countTables) {
    const result = await client.query(`select count(*)::int as count from public.${table}`);
    counts[table] = result.rows[0]?.count ?? 0;
  }
  return counts;
}

// Tables whose read/insert/update policies should now reference has_project_access.
const scopedTables = [
  "products",
  "scenarios",
  "stations",
  "zones",
  "tasks",
  "task_dependencies",
  "manufacturing_steps",
  "part_references",
  "actual_events",
  "custom_columns",
  "step_photos",
  "step_tools",
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Add it to your gitignored .env.local from Supabase Dashboard -> Project Settings -> Database -> Connection string (URI), then run with --env-file.",
    );
  }

  const migrations = [];
  for (const file of MIGRATION_FILES) {
    const sql = await readFile(path.join(process.cwd(), "supabase", "migrations", file), "utf8");
    assertMigrationIsNonDestructive(sql, file);
    migrations.push({ file, sql });
  }

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const before = await countRows(client);
    console.log("Row counts before migration:");
    console.log(before);

    await client.query("begin");
    for (const migration of migrations) {
      console.log(`Applying ${migration.file} ...`);
      await client.query(migration.sql);
    }
    await client.query("commit");

    const after = await countRows(client);
    console.log("Row counts after migration:");
    console.log(after);

    for (const table of countTables) {
      if (before[table] !== after[table]) {
        throw new Error(`Row count changed for ${table}: ${before[table]} -> ${after[table]}`);
      }
    }

    // Post-checks: the helper exists and every scoped table's read/insert/update/delete
    // policies now reference has_project_access (qual/with_check expression contains the name).
    const checks = {
      has_project_access_fn: (await client.query(
        "select exists(select 1 from pg_proc where proname = 'has_project_access') as ok",
      )).rows[0]?.ok,
      project_resolvers: (await client.query(
        "select count(*) = 4 as ok from pg_proc where proname in ('product_project_id','scenario_project_id','task_project_id','custom_column_project_id')",
      )).rows[0]?.ok,
      projects_read_scoped: (await client.query(
        "select pg_get_expr(polqual, polrelid) like '%has_project_access%' as ok from pg_policy where polname = 'projects member read'",
      )).rows[0]?.ok,
    };

    for (const table of scopedTables) {
      const result = await client.query(
        `select bool_and(
            coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
            like '%has_project_access%'
          ) as ok
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         where c.relname = $1 and p.polcmd in ('r', 'a', 'w', 'd')`,
        [table],
      );
      checks[`${table}_scoped`] = result.rows[0]?.ok;
    }

    console.log("Post-migration checks:");
    console.log(checks);

    const failed = Object.entries(checks).filter(([, ok]) => ok !== true);
    if (failed.length) {
      throw new Error(`Post-migration checks failed: ${failed.map(([key]) => key).join(", ")}`);
    }

    console.log("Migration applied successfully. No data-table row counts changed; all policies scoped.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
