// Read-only probe: reports whether the objects created by the 5 new migrations
// already exist in the target database. Makes NO writes.
import pg from "pg";

const checks = {
  "120000 platform_admins table": "select to_regclass('public.platform_admins') is not null as ok",
  "120000 is_super_admin() fn": "select exists(select 1 from pg_proc where proname='is_super_admin') as ok",
  "120000 superadmin seeded": "select exists(select 1 from public.platform_admins where email='rlopez@anacorp.com') as ok",
  "121000 workspace_members.modules": "select exists(select 1 from information_schema.columns where table_name='workspace_members' and column_name='modules') as ok",
  "121000 access_grants.modules": "select exists(select 1 from information_schema.columns where table_name='workspace_access_grants' and column_name='modules') as ok",
  "122000 can_view_member_profile() fn": "select exists(select 1 from pg_proc where proname='can_view_member_profile') as ok",
  "122000 profiles manager policy": "select exists(select 1 from pg_policies where tablename='profiles' and policyname='profiles workspace manager read') as ok",
  "123000 access_level enum": "select exists(select 1 from pg_type where typname='access_level') as ok",
  "123000 project_access table": "select to_regclass('public.project_access') is not null as ok",
  "123000 org_tool_access table": "select to_regclass('public.org_tool_access') is not null as ok",
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const results = {};
    for (const [label, sql] of Object.entries(checks)) {
      try {
        results[label] = (await client.query(sql)).rows[0]?.ok === true ? "YES" : "no";
      } catch (e) {
        results[label] = `ERR: ${e.message}`;
      }
    }
    const yes = Object.values(results).filter((v) => v === "YES").length;
    const total = Object.keys(results).length;
    console.log(results);
    console.log(`\nSummary: ${yes}/${total} expected objects present.`);
    if (yes === 0) console.log("=> Migrations appear NOT applied.");
    else if (yes === total) console.log("=> Migrations appear FULLY applied.");
    else console.log("=> PARTIALLY applied — review before running appliers.");
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
