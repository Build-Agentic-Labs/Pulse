// Applies ONE migration file to the isolated local database (never a remote one) and proves it
// preserved every existing record: each pre-existing table's row count and content checksum
// (public tables, storage.objects, auth.users) must be identical before and after.
//
//   node scripts/verify-local-migration.mjs supabase/migrations/<file>.sql
//
// The migration and its ledger row are applied in one transaction. No reset, no other migration.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import pg from "pg";

const connectionString = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const file = process.argv[2];
if (!file || !/^\d{14}_[a-z0-9_]+\.sql$/.test(basename(file))) {
  throw new Error("Pass one migration file: supabase/migrations/<14-digit version>_<name>.sql");
}
const [, version, name] = basename(file).match(/^(\d{14})_(.+)\.sql$/);
const sql = readFileSync(file, "utf8");

const db = new pg.Client({ connectionString });
await db.connect();

async function checksums() {
  const { rows: tables } = await db.query(`
    select format('%I.%I', n.nspname, c.relname) as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
       and (n.nspname = 'public' or (n.nspname, c.relname) in (('storage', 'objects'), ('auth', 'users')))
     order by 1`);
  const result = new Map();
  for (const { name: table } of tables) {
    const { rows } = await db.query(
      `select count(*)::int as count, md5(coalesce(string_agg(t::text, E'\\n' order by t::text), '')) as hash from ${table} t`,
    );
    result.set(table, rows[0]);
  }
  return result;
}

const already = await db.query("select 1 from supabase_migrations.schema_migrations where version = $1", [version]);
if (already.rowCount) {
  console.log(`${version} is already applied; nothing to do.`);
  await db.end();
  process.exit(0);
}

const before = await checksums();
await db.query("begin");
try {
  await db.query(sql);
  await db.query("insert into supabase_migrations.schema_migrations(version, name, statements) values ($1, $2, $3)", [version, name, [sql]]);
  await db.query("commit");
} catch (error) {
  await db.query("rollback");
  throw error;
}
const after = await checksums();

const changed = [...before].filter(([table, value]) => {
  const next = after.get(table);
  return !next || next.count !== value.count || next.hash !== value.hash;
});
const added = [...after.keys()].filter((table) => !before.has(table));
console.log(`Applied ${version}_${name}. Tables checked: ${before.size}. New tables: ${added.join(", ") || "none"}.`);
for (const [table, value] of before) {
  if (["storage.objects", "auth.users"].includes(table)) console.log(`  ${table}: ${value.count} rows, unchanged=${!changed.some(([t]) => t === table)}`);
}
await db.end();
if (changed.length) {
  console.error(`Existing records changed in: ${changed.map(([table]) => table).join(", ")}`);
  process.exit(1);
}
console.log(`Every pre-existing record is unchanged (${[...before.values()].reduce((total, value) => total + value.count, 0)} rows).`);
