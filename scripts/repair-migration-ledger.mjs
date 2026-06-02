// Backfill Supabase's migration ledger (supabase_migrations.schema_migrations) for any
// migration file that was applied out-of-band by the custom appliers and therefore never
// recorded. Without this, `supabase migration list` / `db push` have no record of these
// versions and could re-run or skip them (audit #13).
//
// Idempotent and metadata-only: inserts version + name with ON CONFLICT DO NOTHING. Touches
// no application data. Run: node --env-file=.env.local scripts/repair-migration-ledger.mjs

import { readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required. Run with --env-file=.env.local.");

  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const existing = new Set(
      (await client.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version),
    );

    const inserted = [];
    for (const file of files) {
      const m = file.match(/^(\d+)_(.*)\.sql$/);
      if (!m) continue;
      const [, version, name] = m;
      if (existing.has(version)) continue;
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing",
        [version, name],
      );
      inserted.push(`${version}_${name}`);
    }

    if (inserted.length) {
      console.log(`✅ Recorded ${inserted.length} migration(s) in the ledger:`);
      inserted.forEach((v) => console.log(`   + ${v}`));
    } else {
      console.log("✅ Ledger already complete -- nothing to backfill.");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
