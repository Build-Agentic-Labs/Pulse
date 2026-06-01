// Applies the user-access feature migrations (superadmin + module scoping) inside a single
// transaction, with the same safety rails as apply-planner-rls-migration.mjs:
//  - refuses any destructive SQL,
//  - asserts no data-table row counts change,
//  - rolls back on any error,
//  - then verifies the expected schema objects exist.
//
// Requires DATABASE_URL (Supabase Dashboard -> Project Settings -> Database -> Connection
// string -> URI). Run with the secret loaded from a gitignored env file, e.g.:
//   node --env-file=C:\Projects\Pulse\.env.local scripts/apply-user-access-migrations.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATION_FILES = [
  "20260601120000_add_platform_superadmin.sql",
  "20260601121000_add_member_module_scope.sql",
  "20260601122000_profiles_manager_read.sql",
  "20260601123000_project_and_org_tools_access.sql",
];

// Data tables whose row counts must be unchanged by these (additive) migrations.
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

    // Post-checks: confirm the new objects exist.
    const checks = {
      platform_admins_table: (await client.query(
        "select to_regclass('public.platform_admins') is not null as ok",
      )).rows[0]?.ok,
      is_super_admin_fn: (await client.query(
        "select exists(select 1 from pg_proc where proname = 'is_super_admin') as ok",
      )).rows[0]?.ok,
      superadmin_seeded: (await client.query(
        "select exists(select 1 from public.platform_admins where email = 'rlopez@anacorp.com') as ok",
      )).rows[0]?.ok,
      members_modules_column: (await client.query(
        "select exists(select 1 from information_schema.columns where table_name='workspace_members' and column_name='modules') as ok",
      )).rows[0]?.ok,
      grants_modules_column: (await client.query(
        "select exists(select 1 from information_schema.columns where table_name='workspace_access_grants' and column_name='modules') as ok",
      )).rows[0]?.ok,
      can_view_member_profile_fn: (await client.query(
        "select exists(select 1 from pg_proc where proname = 'can_view_member_profile') as ok",
      )).rows[0]?.ok,
      profiles_manager_policy: (await client.query(
        "select exists(select 1 from pg_policies where tablename='profiles' and policyname='profiles workspace manager read') as ok",
      )).rows[0]?.ok,
      access_level_enum: (await client.query(
        "select exists(select 1 from pg_type where typname='access_level') as ok",
      )).rows[0]?.ok,
      project_access_table: (await client.query(
        "select to_regclass('public.project_access') is not null as ok",
      )).rows[0]?.ok,
      org_tool_access_table: (await client.query(
        "select to_regclass('public.org_tool_access') is not null as ok",
      )).rows[0]?.ok,
      project_access_backfilled: (await client.query(
        "select (select count(*) from public.project_access) >= (select count(*) from public.workspace_members wm join public.projects p on p.workspace_id = wm.workspace_id) as ok",
      )).rows[0]?.ok,
    };
    console.log("Post-migration checks:");
    console.log(checks);

    const failed = Object.entries(checks).filter(([, ok]) => ok !== true);
    if (failed.length) {
      throw new Error(`Post-migration checks failed: ${failed.map(([key]) => key).join(", ")}`);
    }

    console.log("Migration applied successfully. No data-table row counts changed; all checks passed.");
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
