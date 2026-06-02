// Reusable, data-safe migration applier for additive / policy-only / function-only migrations.
//
// Safety rails (stronger than the per-migration appliers it generalizes):
//   - refuses destructive SQL (drop table/column, truncate, delete, drop schema),
//   - snapshots row counts of EVERY base table in public before applying,
//   - applies inside a single transaction,
//   - re-counts and runs all post-checks INSIDE the transaction, BEFORE commit, so any
//     unexpected row-count change or failed check triggers a real ROLLBACK
//     (the existing appliers assert after COMMIT -- audit finding H-2 -- this fixes that),
//   - auto-derives post-checks from the migration text: every `create policy "X" on T` must
//     exist afterwards, and every `create or replace function public.fn(` must exist,
//   - optionally smoke-calls zero-arg-safe SECURITY DEFINER predicates passed via --smoke.
//
// Usage (load the secret from your gitignored env file):
//   node --env-file=.env.local scripts/apply-migration-safely.mjs <migration1.sql> [migration2.sql ...]
//   node --env-file=.env.local scripts/apply-migration-safely.mjs --smoke "has_project_access('x','view'::access_level)" 20260601125000_*.sql

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

function assertNonDestructive(sql, label) {
  const forbidden = [
    /\bdrop\s+table\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
    /\bdrop\s+schema\b/i,
    /\balter\s+table\b[\s\S]+?\bdrop\s+column\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(sql)) {
      throw new Error(`Refusing to run ${label}: matched unsafe pattern ${pattern}`);
    }
  }
}

async function allBaseTables(client) {
  const result = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );
  return result.rows.map((r) => r.table_name);
}

async function countRows(client, tables) {
  const counts = {};
  for (const table of tables) {
    const result = await client.query(`select count(*)::int as count from public.${table}`);
    counts[table] = result.rows[0]?.count ?? 0;
  }
  return counts;
}

// Derive expected objects from migration SQL so post-checks need no hand-maintenance.
function derivePostChecks(sql) {
  const policies = [];
  // Capture optional schema (e.g. storage.objects); relname is the last dotted segment.
  const policyRe = /create\s+policy\s+"([^"]+)"\s+on\s+([a-z_][a-z0-9_.]*)/gi;
  let m;
  while ((m = policyRe.exec(sql)) !== null) {
    const parts = m[2].split(".");
    policies.push({ name: m[1], table: parts[parts.length - 1] });
  }

  const functions = [];
  const fnRe = /create\s+or\s+replace\s+function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  while ((m = fnRe.exec(sql)) !== null) functions.push(m[1]);

  return { policies, functions: [...new Set(functions)] };
}

async function main() {
  const argv = process.argv.slice(2);
  const smokeExprs = [];
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--smoke") {
      smokeExprs.push(argv[++i]);
    } else {
      files.push(argv[i]);
    }
  }

  if (!files.length) {
    // Default: any *.sql passed by glob; otherwise error.
    throw new Error("Provide one or more migration filenames (relative to supabase/migrations/).");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Run with --env-file=.env.local.");
  }

  const migrations = [];
  for (const file of files) {
    const base = path.basename(file);
    const sql = await readFile(path.join(MIGRATIONS_DIR, base), "utf8");
    assertNonDestructive(sql, base);
    migrations.push({ file: base, sql, checks: derivePostChecks(sql) });
  }

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const tables = await allBaseTables(client);
    const before = await countRows(client, tables);

    await client.query("begin");
    for (const migration of migrations) {
      console.log(`Applying ${migration.file} ...`);
      await client.query(migration.sql);
    }

    // --- all assertions INSIDE the transaction, before commit ---
    const after = await countRows(client, tables);
    const changed = tables.filter((t) => before[t] !== after[t]);
    if (changed.length) {
      throw new Error(
        `Row counts changed (rolling back): ${changed
          .map((t) => `${t}: ${before[t]} -> ${after[t]}`)
          .join(", ")}`,
      );
    }

    const failures = [];
    for (const migration of migrations) {
      for (const fn of migration.checks.functions) {
        const ok = (await client.query("select exists(select 1 from pg_proc where proname = $1) as ok", [fn]))
          .rows[0]?.ok;
        if (!ok) failures.push(`function ${fn} missing`);
      }
      for (const pol of migration.checks.policies) {
        const ok = (
          await client.query(
            `select exists(
               select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
               where p.polname = $1 and c.relname = $2
             ) as ok`,
            [pol.name, pol.table],
          )
        ).rows[0]?.ok;
        if (!ok) failures.push(`policy "${pol.name}" on ${pol.table} missing`);
      }
    }

    // Smoke-call predicates to prove function bodies resolve (catches search_path='' typos).
    // Runs as the connection role with auth.uid() = null, so these must return without error.
    for (const expr of smokeExprs) {
      try {
        await client.query(`select public.${expr}`);
      } catch (e) {
        failures.push(`smoke call public.${expr} failed: ${e.message}`);
      }
    }

    if (failures.length) {
      throw new Error(`Post-checks failed (rolling back):\n  - ${failures.join("\n  - ")}`);
    }

    await client.query("commit");
    console.log(`\n✅ Applied ${migrations.length} migration(s). ${tables.length} tables checked, 0 row-count changes.`);
    console.log(
      `   Verified ${migrations.reduce((n, m) => n + m.checks.policies.length, 0)} policies, ` +
        `${migrations.reduce((n, m) => n + m.checks.functions.length, 0)} functions` +
        (smokeExprs.length ? `, ${smokeExprs.length} smoke call(s)` : "") +
        ".",
    );
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error("\n❌ Rolled back. No changes committed.");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
